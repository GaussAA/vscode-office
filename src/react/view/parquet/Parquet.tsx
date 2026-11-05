import { MoonOutlined, SunOutlined } from '@ant-design/icons';
import { App, Input, type InputRef, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import '@vscode/codicons/dist/codicon.css';
import { $t } from '../../i18n/i18nConfig.ts';
import { handler, vscodeApi } from '../../util/vscode.ts';
import { arrayBufferFromPayload } from '../../util/loadOfficeContent.ts';
import { openParquetSource } from '../../util/parquetSource.ts';
import { ParquetSession } from './parquetSession.ts';
import SponsorBar from '../components/SponsorBar.tsx';
import {
    formatCellValue,
    PARQUET_PAGE_SIZE,
    isColumnEditable,
    openParquetFile,
    parseCellInput,
    readParquetRows,
    writeParquetBuffer,
    type ParquetColumnInfo,
    type ParquetFileInfo,
} from './parquetParser.ts';
import './Parquet.less';

const PAGE_SIZE = PARQUET_PAGE_SIZE;
/** Above this many rows, editing is disabled: saving would re-read the whole file. */
const EDIT_ROW_LIMIT = 200_000;
/** Rows read per batch while searching the whole file. */
const SEARCH_BATCH = 5_000;
/** Cap on matched rows kept in memory (highlight + navigation). */
const SEARCH_MAX_ROWS = 5_000;

/** Wrap the matched runs of a cell value in <mark>, so a hit is visible in place. */
function highlightCell(text: string, needle: string) {
    if (!needle) return text;
    const lower = text.toLowerCase();
    const query = needle.toLowerCase();
    const parts: React.ReactNode[] = [];
    let cursor = 0;
    let key = 0;
    while (cursor < text.length && key < 20) {
        const at = lower.indexOf(query, cursor);
        if (at < 0) break;
        if (at > cursor) parts.push(text.slice(cursor, at));
        parts.push(<mark key={key++} className="parquet-viewer__hit">{text.slice(at, at + query.length)}</mark>);
        cursor = at + query.length;
    }
    if (cursor < text.length) parts.push(text.slice(cursor));
    return parts;
}
const PARQUET_VSCODE_THEME_KEY = 'parquet-vscode-theme';

type ColumnIconKind = 'bool' | 'numeric' | 'string' | 'datetime' | 'structure' | 'field';

function loadParquetVscodeTheme(): boolean {
    const state = vscodeApi?.getState?.() as { parquetVscodeTheme?: boolean } | undefined;
    if (state?.parquetVscodeTheme !== undefined) {
        return state.parquetVscodeTheme;
    }
    try {
        const saved = localStorage.getItem(PARQUET_VSCODE_THEME_KEY);
        if (saved !== null) {
            return saved === '1';
        }
    } catch { }
    return true;
}

function saveParquetVscodeTheme(vscodeTheme: boolean) {
    try {
        localStorage.setItem(PARQUET_VSCODE_THEME_KEY, vscodeTheme ? '1' : '0');
    } catch { }
    if (vscodeApi?.setState) {
        const prev = (vscodeApi.getState?.() ?? {}) as Record<string, unknown>;
        vscodeApi.setState({ ...prev, parquetVscodeTheme: vscodeTheme });
    }
}

function resolveColumnIcon(type: string): { icon: string; kind: ColumnIconKind } {
    const upper = `${type}`.toUpperCase();
    if (upper.includes('BOOL')) return { icon: 'codicon-symbol-boolean', kind: 'bool' };
    if (upper.includes('INT') || upper.includes('FLOAT') || upper.includes('DOUBLE') || upper.includes('DECIMAL') || upper.includes('NUM')) {
        return { icon: 'codicon-symbol-numeric', kind: 'numeric' };
    }
    if (upper.includes('STRING') || upper.includes('BYTE') || upper.includes('UTF8')) {
        return { icon: 'codicon-symbol-string', kind: 'string' };
    }
    if (upper.includes('TIME') || upper.includes('DATE')) {
        return { icon: 'codicon-symbol-event', kind: 'datetime' };
    }
    if (upper.includes('JSON') || upper.includes('STRUCT') || upper.includes('MAP') || upper.includes('LIST')) {
        return { icon: 'codicon-symbol-structure', kind: 'structure' };
    }
    return { icon: 'codicon-symbol-field', kind: 'field' };
}

type TableRow = Record<string, unknown> & { key: string };

/** Codecs actually used by this file's column chunks. */
function collectCodecs(metadata: unknown): string[] {
    const codecs = new Set<string>();
    const groups = (metadata as {
        row_groups?: Array<{ columns?: Array<{ meta_data?: { codec?: string } }> }>;
    })?.row_groups ?? [];
    for (const group of groups) {
        for (const column of group.columns ?? []) {
            const codec = column.meta_data?.codec;
            if (codec) codecs.add(codec);
        }
    }
    return [...codecs];
}

function ParquetViewer() {
    const { message, modal } = App.useApp();
    const [fileInfo, setFileInfo] = useState<ParquetFileInfo | null>(null);
    const [pageRows, setPageRows] = useState<Record<string, unknown>[]>([]);
    const [pageLoading, setPageLoading] = useState(false);
    const [largeFile, setLargeFile] = useState(false);
    const [rowJump, setRowJump] = useState('');
    const [inspected, setInspected] = useState<{ row: number; column: string; value: unknown } | null>(null);
    const [query, setQuery] = useState('');
    const [searching, setSearching] = useState(false);
    const [searchProgress, setSearchProgress] = useState<{ scanned: number; total: number; matches: number } | null>(null);
    const [matchRows, setMatchRows] = useState<Set<number>>(() => new Set());
    const [page, setPage] = useState(0);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [editingRow, setEditingRow] = useState<number | null>(null);
    const [editingColumn, setEditingColumn] = useState<string | null>(null);
    const [editValue, setEditValue] = useState('');
    const [dirty, setDirty] = useState(false);
    const [saving, setSaving] = useState(false);
    const [readOnly, setReadOnly] = useState(false);
    /** `${absoluteRow}:${column}` for every patched cell, so render never reads a ref. */
    const [editedCells, setEditedCells] = useState<Set<string>>(() => new Set());
    const [vscodeTheme, setVscodeTheme] = useState(loadParquetVscodeTheme);
    const fileInfoRef = useRef<ParquetFileInfo | null>(null);
    /** Owns the page cache, the edit patches, cancellation and the page<->row arithmetic. */
    const sessionRef = useRef<ParquetSession | null>(null);
    const searchSeq = useRef(0);
    const dirtyRef = useRef(false);
    const savingRef = useRef(false);
    const editInputRef = useRef<InputRef | null>(null);

    const totalPages = useMemo(() => {
        if (!fileInfo?.rowCount) return 1;
        return Math.max(1, Math.ceil(fileInfo.rowCount / PAGE_SIZE));
    }, [fileInfo?.rowCount]);

    const tableRows = useMemo<TableRow[]>(() => {
        return pageRows.map((row, index) => ({
            ...row,
            key: `${page}-${index}`,
        }));
    }, [pageRows, page]);

    const toggleTheme = () => {
        setVscodeTheme((prev) => {
            const next = !prev;
            saveParquetVscodeTheme(next);
            return next;
        });
    };

    const cancelEdit = useCallback(() => {
        setEditingRow(null);
        setEditingColumn(null);
        setEditValue('');
    }, []);

    const markDirty = useCallback(() => {
        if (dirtyRef.current) return;
        dirtyRef.current = true;
        setDirty(true);
        handler.emit('change');
    }, []);

    const handleSave = useCallback(() => {
        const info = fileInfoRef.current;
        const session = sessionRef.current;
        if (!info || !session || !dirtyRef.current || savingRef.current || session.readOnly) return;

        const write = async () => {
            savingRef.current = true;
            setSaving(true);
            try {
                // Display rows are lazy, so saving re-reads the whole file and re-applies every
                // recorded edit before serialising. This is the price of keeping the writer's
                // semantics while not holding every row in memory.
                const rows = await session.rowsForSave();
                const buffer = writeParquetBuffer(info.columns, rows);
                handler.emit('save', [...new Uint8Array(buffer)]);
            } catch (e) {
                savingRef.current = false;
                setSaving(false);
                const errMessage = e instanceof Error ? e.message : 'Failed to serialize parquet file';
                setError(errMessage);
                message.error(errMessage);
            }
        };

        // Fork addition: hyparquet-compressors can READ zstd/gzip/brotli/lz4 but the
        // writer only encodes SNAPPY. Saving would silently re-encode the file, so warn.
        const reencoded = collectCodecs(info.metadata).filter(codec => codec !== 'SNAPPY');
        if (reencoded.length === 0) {
            void write();
            return;
        }
        modal.confirm({
            title: 'Saving will change the compression codec',
            content: `This file stores its columns as ${reencoded.join(', ')}. Saving writes every column back as SNAPPY, so the file's encoding changes even though the data does not.`,
            okText: 'Save anyway',
            cancelText: 'Cancel',
            onOk: () => { void write(); },
        });
    }, [message, modal]);

    const startEdit = useCallback((rowIndex: number, column: ParquetColumnInfo, value: unknown) => {
        if (sessionRef.current?.readOnly || !isColumnEditable(column.type)) return;
        setEditingRow(rowIndex);
        setEditingColumn(column.name);
        setEditValue(formatCellValue(value));
    }, []);

    useEffect(() => {
        if (editingRow == null || !editingColumn) return;
        editInputRef.current?.focus();
        editInputRef.current?.select();
    }, [editingColumn, editingRow]);

    const commitEdit = useCallback((rowIndex: number, column: ParquetColumnInfo) => {
        if (editingRow !== rowIndex || editingColumn !== column.name) return;
        const session = sessionRef.current;
        if (!session) return;
        const row = session.rows[rowIndex - session.startOf(session.page)];
        if (!row) {
            cancelEdit();
            return;
        }
        const nextValue = parseCellInput(editValue, column.type);
        if (formatCellValue(row[column.name]) === formatCellValue(nextValue)) {
            cancelEdit();
            return;
        }

        // The session records the edit against the absolute row, so it survives page changes
        // and is re-applied when the file is saved.
        if (!session.patch(rowIndex, column.name, nextValue)) {
            cancelEdit();
            return;
        }
        setPageRows([...session.rows]);
        setEditedCells(new Set(session.editedCells));
        cancelEdit();
        markDirty();
    }, [cancelEdit, editValue, editingColumn, editingRow, markDirty]);

    const loadParquet = useCallback(async (payload: { path?: string; buffer?: number[]; readOnly?: boolean }) => {
        setLoading(true);
        setError(null);
        setFileInfo(null);
        fileInfoRef.current = null;
        sessionRef.current?.reset();
        sessionRef.current = null;
        setPageRows([]);
        setEditedCells(new Set());
        setInspected(null);
        searchSeq.current++;
        setSearching(false);
        setSearchProgress(null);
        setMatchRows(new Set());
        setQuery('');
        setPage(0);
        cancelEdit();
        dirtyRef.current = false;
        setDirty(false);
        savingRef.current = false;
        setSaving(false);
        const fileReadOnly = payload.readOnly === true;
        try {
            // Files arrive either as an inline byte array (virtual documents) or as a
            // fetchable URI. For URIs we probe Range support so hyparquet pulls only the
            // footer and the pages it needs, instead of the whole file.
            const info = payload.buffer?.length
                ? await openParquetFile(arrayBufferFromPayload(payload))
                : await openParquetFile((await openParquetSource(payload.path ?? '')).file);
            fileInfoRef.current = info;
            setFileInfo(info);

            const session = new ParquetSession(
                {
                    rowCount: info.rowCount,
                    readOnly: fileReadOnly,
                    readRows: (start, end) => readParquetRows(info.file, info.metadata, start, end),
                },
                { pageSize: PAGE_SIZE, editRowLimit: EDIT_ROW_LIMIT },
            );
            sessionRef.current = session;
            // Saving re-reads every row, so a huge file is read-only; the session derives both.
            setLargeFile(session.largeFile);
            setReadOnly(session.readOnly);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to load parquet file');
        } finally {
            setLoading(false);
        }
    }, [cancelEdit]);

    // Rows are read one page at a time; a big file no longer materialises every row in the
    // webview. The session owns the cache, the prefetch and the "only the newest page wins"
    // guard, so this effect is only wiring.
    useEffect(() => {
        const session = sessionRef.current;
        if (!session) return;
        let live = true;
        setPageLoading(true);
        void session
            .showPage(page)
            .then(snapshot => {
                if (!live || snapshot.stale) return;
                setPageRows(snapshot.rows);
                setPageLoading(false);
            })
            .catch((e: unknown) => {
                if (!live) return;
                setPageLoading(false);
                setError(e instanceof Error ? e.message : 'Failed to read rows');
            });
        session.prefetch(page + 1);
        return () => {
            live = false;
        };
    }, [fileInfo, page]);

    /** Every page change drops the inspector: it points at a row on the old page. */
    const goToPage = useCallback((next: number | ((current: number) => number)) => {
        setInspected(null);
        setPage(next);
    }, []);

    const jumpToRow = useCallback(() => {
        const info = fileInfoRef.current;
        if (!info) return;
        const target = Number.parseInt(rowJump, 10);
        if (!Number.isFinite(target)) return;
        const row = Math.max(1, Math.min(info.rowCount, target));
        cancelEdit();
        goToPage(Math.floor((row - 1) / PAGE_SIZE));
    }, [rowJump, cancelEdit, goToPage]);

    const rowRange = useMemo(() => {
        if (!fileInfo) return '';
        const start = page * PAGE_SIZE + 1;
        const end = Math.min(fileInfo.rowCount, (page + 1) * PAGE_SIZE);
        return `${start.toLocaleString()}–${end.toLocaleString()} of ${fileInfo.rowCount.toLocaleString()}`;
    }, [fileInfo, page]);

    const runSearch = useCallback(async () => {
        const info = fileInfoRef.current;
        const session = sessionRef.current;
        const needle = query.trim().toLowerCase();
        const seq = ++searchSeq.current;
        setMatchRows(new Set());
        if (!info || !session || !needle) {
            setSearching(false);
            setSearchProgress(null);
            return;
        }
        setSearching(true);
        setSearchProgress({ scanned: 0, total: info.rowCount, matches: 0 });
        const found = new Set<number>();
        try {
            // Batch by batch, so a 250k-row file never lands in memory at once and the
            // scan can be cancelled by a newer query. Reading through the session means the
            // scan sees edited cells, exactly like the table does.
            for (let start = 0; start < info.rowCount; start += SEARCH_BATCH) {
                if (seq !== searchSeq.current) return;
                const end = Math.min(info.rowCount, start + SEARCH_BATCH);
                const rows = await session.readRange(start, end);
                for (let offset = 0; offset < rows.length; offset++) {
                    const row = rows[offset];
                    const hit = info.columns.some(column =>
                        formatCellValue(row[column.name]).toLowerCase().includes(needle));
                    if (hit) found.add(start + offset);
                }
                setSearchProgress({ scanned: end, total: info.rowCount, matches: found.size });
                if (found.size >= SEARCH_MAX_ROWS) break;
                await new Promise(resolve => window.setTimeout(resolve, 0));
            }
            if (seq !== searchSeq.current) return;
            setMatchRows(found);
            if (found.size > 0) {
                const first = found.values().next().value as number;
                const target = Math.floor(first / PAGE_SIZE);
                goToPage(current => (current === target ? current : target));
            }
        } catch (e) {
            if (seq === searchSeq.current) setError(e instanceof Error ? e.message : 'Search failed');
        } finally {
            if (seq === searchSeq.current) setSearching(false);
        }
    }, [query, goToPage]);

    const jumpMatch = useCallback((direction: 1 | -1) => {
        if (matchRows.size === 0) return;
        const sorted = [...matchRows].sort((a, b) => a - b);
        const pageStart = page * PAGE_SIZE;
        const pageEnd = pageStart + PAGE_SIZE;
        const target = direction > 0
            ? sorted.find(row => row >= pageEnd) ?? sorted[0]
            : [...sorted].reverse().find(row => row < pageStart) ?? sorted[sorted.length - 1];
        goToPage(Math.floor(target / PAGE_SIZE));
    }, [matchRows, page, goToPage]);

    // clearing the box drops the previous results
    const resetSearch = useCallback(() => {
        searchSeq.current++;
        setSearching(false);
        setSearchProgress(null);
        setMatchRows(new Set());
    }, []);

    const handleQueryChange = useCallback((next: string) => {
        setQuery(next);
        if (!next.trim()) resetSearch();
    }, [resetSearch]);
    const tableColumns = useMemo<ColumnsType<TableRow>>(() => {
        if (!fileInfo) return [];
        const cols: ColumnsType<TableRow> = [
            {
                title: '#',
                key: '__index',
                width: 64,
                align: 'center',
                fixed: 'left',
                render: (_value, _row, index) => page * PAGE_SIZE + index + 1,
            },
        ];
        for (const column of fileInfo.columns) {
            const kind = resolveColumnIcon(column.type).kind;
            cols.push({
                title: column.name,
                dataIndex: column.name,
                key: column.name,
                ellipsis: true,
                minWidth: 120,
                align: kind === 'numeric' ? 'right' : 'left',
                render: (value: unknown, _row, index) => {
                    const rowIndex = page * PAGE_SIZE + index;
                    const editing = editingRow === rowIndex && editingColumn === column.name;
                    if (editing) {
                        return (
                            <Input
                                ref={editInputRef}
                                size="small"
                                className="parquet-viewer__cell-input"
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                onBlur={() => commitEdit(rowIndex, column)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') commitEdit(rowIndex, column);
                                    if (e.key === 'Escape') cancelEdit();
                                }}
                            />
                        );
                    }
                    const cellKind = resolveColumnIcon(column.type).kind;
                    const isNull = value === null || value === undefined;
                    const edited = editedCells.has(`${rowIndex}:${column.name}`);
                    const classes = [
                        'parquet-viewer__cell',
                        `parquet-viewer__cell--${cellKind}`,
                        isNull ? 'parquet-viewer__cell--null' : '',
                        edited ? 'parquet-viewer__cell--edited' : '',
                        !readOnly && isColumnEditable(column.type) ? 'parquet-viewer__cell--editable' : '',
                    ].filter(Boolean).join(' ');
                    return (
                        <span
                            className={classes}
                            title={isNull ? 'null' : formatCellValue(value)}
                            onDoubleClick={() => startEdit(rowIndex, column, value)}
                            onClick={() => setInspected({ row: rowIndex, column: column.name, value })}
                        >
                            {isNull ? 'NULL' : highlightCell(formatCellValue(value), query.trim())}
                        </span>
                    );
                },
            });
        }
        return cols;
    }, [cancelEdit, commitEdit, editValue, editedCells, editingColumn, editingRow, fileInfo, page, query, readOnly, startEdit]);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return;
            event.preventDefault();
            handleSave();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [handleSave]);

    useEffect(() => {
        handler
            .on('open', (payload) => { void loadParquet(payload); })
            .on('saveDone', () => {
                savingRef.current = false;
                setSaving(false);
                dirtyRef.current = false;
                setDirty(false);
                message.success($t('parquet.saveSuccess'));
            })
            .emit('init');
    }, [loadParquet, message]);

    // the inspector bar sits between the table and the footer, so shrink the table when it shows
    const tableHeight = inspected ? 'calc(100vh - 196px)' : 'calc(100vh - 132px)';

    return (
        <div className={`parquet-viewer${vscodeTheme ? '' : ' parquet-viewer--light'}`}>
            {loading && (
                <div className="parquet-viewer__overlay">
                    <span className="codicon codicon-loading codicon-modifier-spin" />
                    <span>{$t('parquet.loading')}</span>
                </div>
            )}
            <div className="parquet-viewer__body">
                <aside className="parquet-viewer__sider">
                    <div className="parquet-viewer__sider-inner">
                        <div className="parquet-viewer__sider-header">
                            <span className="codicon codicon-symbol-structure parquet-icon parquet-icon--schema" />
                            {$t('parquet.schema')}
                        </div>
                        {fileInfo && (
                            <div className="parquet-viewer__meta">
                                <div className="parquet-viewer__stat">
                                    <span className="parquet-viewer__stat-label">
                                        <span className="codicon codicon-list-flat parquet-icon parquet-icon--rows" />
                                        {$t('parquet.rows')}
                                    </span>
                                    <span className="parquet-viewer__stat-value">{fileInfo.rowCount.toLocaleString()}</span>
                                </div>
                                <div className="parquet-viewer__stat">
                                    <span className="parquet-viewer__stat-label">
                                        <span className="codicon codicon-symbol-field parquet-icon parquet-icon--columns" />
                                        {$t('parquet.columnsLabel')}
                                    </span>
                                    <span className="parquet-viewer__stat-value">{fileInfo.columns.length}</span>
                                </div>
                                {fileInfo.createdBy && (
                                    <div className="parquet-viewer__stat parquet-viewer__stat--wide" title={fileInfo.createdBy}>
                                        <span className="parquet-viewer__stat-label">
                                            <span className="codicon codicon-account parquet-icon parquet-icon--author" />
                                            {$t('parquet.createdBy')}
                                        </span>
                                        <span className="parquet-viewer__stat-value">
                                            {fileInfo.createdBy.length > 48 ? `${fileInfo.createdBy.slice(0, 48)}…` : fileInfo.createdBy}
                                        </span>
                                    </div>
                                )}
                            </div>
                        )}
                        <div className="parquet-viewer__list">
                            {fileInfo?.columns.map((column) => {
                                const { icon, kind } = resolveColumnIcon(column.type);
                                return (
                                <div key={column.name} className="parquet-viewer__list-item">
                                    <span className={`codicon parquet-viewer__list-icon parquet-viewer__list-icon--${kind} ${icon}`} />
                                    <span className="parquet-viewer__list-name" title={column.name}>{column.name}</span>
                                    <span className="parquet-viewer__list-type">{column.type}</span>
                                </div>
                                );
                            })}
                        </div>
                    </div>
                </aside>
                <main className="parquet-viewer__main">
                    {readOnly && !loading && !error && fileInfo && (
                        <div className="parquet-viewer__readonly-banner">
                            {largeFile
                                ? `Read-only: ${fileInfo.rowCount.toLocaleString()} rows. Editing is disabled because saving re-reads the whole file.`
                                : $t('viewer.readOnly')}
                        </div>
                    )}
                    {error ? (
                        <div className="parquet-viewer__empty">
                            <div className="parquet-viewer__error">
                                <span className="codicon codicon-error" />
                                <span>{error}</span>
                            </div>
                        </div>
                    ) : fileInfo ? (
                        <>
                            <div className="parquet-viewer__toolbar">
                                <div className="parquet-viewer__toolbar-left">
                                    {dirty && <span className="parquet-viewer__dirty-dot" title={$t('parquet.unsaved')} />}
                                    <button
                                        type="button"
                                        className="parquet-viewer__save-btn"
                                        disabled={!dirty || saving || readOnly}
                                        onClick={handleSave}
                                    >
                                        <span className={`codicon ${saving ? 'codicon-loading codicon-modifier-spin' : 'codicon-save'}`} />
                                        {$t('parquet.save')}
                                    </button>
                                    <div className="parquet-viewer__find">
                                        <input
                                            className="parquet-viewer__find-input"
                                            placeholder="Find in file"
                                            value={query}
                                            onChange={event => handleQueryChange(event.target.value)}
                                            onKeyDown={event => {
                                                if (event.key === 'Enter') void runSearch();
                                            }}
                                        />
                                        <button
                                            type="button"
                                            className="parquet-viewer__find-btn"
                                            onClick={() => { void runSearch(); }}
                                            disabled={searching || !fileInfo}
                                            title="Search all rows"
                                            aria-label="Search all rows"
                                        >
                                            <span className={`codicon ${searching ? 'codicon-loading codicon-modifier-spin' : 'codicon-search'}`} />
                                        </button>
                                        {searching && searchProgress && (
                                            <span className="parquet-viewer__find-count">
                                                {Math.round((searchProgress.scanned / Math.max(1, searchProgress.total)) * 100)}%
                                                {' · '}
                                                {searchProgress.matches}
                                            </span>
                                        )}
                                        {!searching && matchRows.size > 0 && (
                                            <>
                                                <span className="parquet-viewer__find-count">
                                                    {matchRows.size.toLocaleString()} row{matchRows.size === 1 ? '' : 's'}
                                                </span>
                                                <button
                                                    type="button"
                                                    className="parquet-viewer__find-btn"
                                                    onClick={() => jumpMatch(-1)}
                                                    title="Previous match"
                                                    aria-label="Previous match"
                                                >
                                                    <span className="codicon codicon-chevron-up" />
                                                </button>
                                                <button
                                                    type="button"
                                                    className="parquet-viewer__find-btn"
                                                    onClick={() => jumpMatch(1)}
                                                    title="Next match"
                                                    aria-label="Next match"
                                                >
                                                    <span className="codicon codicon-chevron-down" />
                                                </button>
                                            </>
                                        )}
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    className="parquet-theme-toggle"
                                    title={vscodeTheme ? $t('common.switchToLight') : $t('common.switchToDark')}
                                    onClick={toggleTheme}
                                    aria-label={vscodeTheme ? $t('common.switchToLight') : $t('common.switchToDark')}
                                >
                                    {vscodeTheme ? <SunOutlined /> : <MoonOutlined />}
                                </button>
                            </div>
                            <div className="parquet-viewer__table-wrap">
                                <Table<TableRow>
                                    className="parquet-table"
                                    dataSource={tableRows}
                                    columns={tableColumns}
                                    pagination={false}
                                    size="small"
                                    scroll={{ y: tableHeight, x: 'max-content' }}
                                    rowClassName={(_row, index) => (matchRows.has(page * PAGE_SIZE + index) ? 'parquet-viewer__row--match' : '')}
                                />
                            </div>
                            {inspected && (
                                <div className="parquet-viewer__inspector">
                                    <span className="parquet-viewer__inspector-label">
                                        {inspected.column} · row {inspected.row + 1}
                                    </span>
                                    <pre className="parquet-viewer__inspector-value">
                                        {inspected.value === null || inspected.value === undefined
                                            ? 'NULL'
                                            : typeof inspected.value === 'string'
                                                ? inspected.value
                                                : formatCellValue(inspected.value)}
                                    </pre>
                                    <button
                                        type="button"
                                        className="parquet-viewer__pager-btn"
                                        onClick={() => {
                                            const text = inspected.value === null || inspected.value === undefined
                                                ? 'null'
                                                : typeof inspected.value === 'string'
                                                    ? inspected.value
                                                    : JSON.stringify(inspected.value);
                                            void navigator.clipboard.writeText(text).catch(() => undefined);
                                        }}
                                        title="Copy value"
                                    >
                                        Copy
                                    </button>
                                    <button
                                        type="button"
                                        className="parquet-viewer__pager-btn"
                                        onClick={() => setInspected(null)}
                                        title="Close"
                                        aria-label="Close"
                                    >
                                        <span className="codicon codicon-close" />
                                    </button>
                                </div>
                            )}
                            <div className="parquet-viewer__footer">
                                <span className="parquet-viewer__footer-total">
                                    {pageLoading && (
                                        <span
                                            className="codicon codicon-loading codicon-modifier-spin"
                                            style={{ marginRight: 6 }}
                                        />
                                    )}
                                    {$t('parquet.totalRows', { count: fileInfo.rowCount.toLocaleString() })}
                                </span>
                                <div className="parquet-viewer__pager">
                                    <button
                                        type="button"
                                        className="parquet-viewer__pager-btn"
                                        disabled={page <= 0}
                                        onClick={() => { cancelEdit(); goToPage((p) => Math.max(0, p - 1)); }}
                                        aria-label="Previous page"
                                    >
                                        <span className="codicon codicon-chevron-left" />
                                    </button>
                                    <Input
                                        size="small"
                                        className="parquet-viewer__row-jump"
                                        placeholder="row"
                                        value={rowJump}
                                        onChange={(event) => setRowJump(event.target.value)}
                                        onPressEnter={jumpToRow}
                                    />
                                    <button
                                        type="button"
                                        className="parquet-viewer__pager-btn"
                                        onClick={jumpToRow}
                                        title="Go to row"
                                    >
                                        Go
                                    </button>
                                    <span className="parquet-viewer__pager-info">{rowRange}</span>
                                    <button
                                        type="button"
                                        className="parquet-viewer__pager-btn"
                                        disabled={page >= totalPages - 1}
                                        onClick={() => { cancelEdit(); goToPage((p) => Math.min(totalPages - 1, p + 1)); }}
                                        aria-label="Next page"
                                    >
                                        <span className="codicon codicon-chevron-right" />
                                    </button>
                                </div>
                            </div>
                        </>
                    ) : null}
                </main>
            </div>
            <div className="parquet-viewer__corner-actions">
                {!loading && <SponsorBar placement="left" />}
            </div>
        </div>
    );
}

export default function Parquet() {
    return (
        <App className="parquet-app">
            <ParquetViewer />
        </App>
    );
}











