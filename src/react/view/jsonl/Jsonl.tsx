import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { Button, ConfigProvider, Input, InputNumber, Splitter, theme as antdTheme } from 'antd';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    JSONL_CHUNK_SIZE,
    type JsonlEntriesPayload,
    type JsonlEntryDetail,
    type JsonlEntryPayload,
    type JsonlEntrySummary,
    type JsonlInfoPayload,
    type JsonlSearchBatch,
} from '../../../common/jsonlTypes.ts';
import { handler } from '../../util/vscode.ts';
import { $t } from '../../i18n/i18nConfig.ts';
import {
    getVscodeThemeColor,
    isVscodeDarkTheme,
    observeVscodeThemeChange,
} from '../../util/vscodeTheme.ts';
import JsonlDetail, { type DetailMode } from './JsonlDetail.tsx';
import JsonlIndex from './JsonlIndex.tsx';
import { formatBytes } from './jsonlFormat.tsx';
import './Jsonl.less';

const DEFAULT_LEFT_WIDTH = 340;
const PERSIST_PREFIX = 'jsonl-state:';
const SEARCH_DEBOUNCE_MS = 250;

interface PersistedState {
    left: number;
    selected: number;
    mode: DetailMode;
}

interface SearchMeta {
    matches: number;
    scanned: number;
    total: number;
    done: boolean;
    capped: boolean;
}

function loadPersisted(cacheId: string): PersistedState | null {
    try {
        const raw = localStorage.getItem(PERSIST_PREFIX + cacheId);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Partial<PersistedState>;
        return {
            left: typeof parsed.left === 'number' ? parsed.left : DEFAULT_LEFT_WIDTH,
            selected: typeof parsed.selected === 'number' ? parsed.selected : 0,
            mode: parsed.mode === 'raw' ? 'raw' : 'tree',
        };
    } catch {
        return null;
    }
}

function savePersisted(cacheId: string, state: PersistedState) {
    try {
        localStorage.setItem(PERSIST_PREFIX + cacheId, JSON.stringify(state));
    } catch {
        // storage may be unavailable; state is a convenience, not a requirement
    }
}

export default function JsonlViewer() {
    const [info, setInfo] = useState<JsonlInfoPayload | null>(null);
    /**
     * The directory window: one contiguous range and its rows, in a single value. The old
     * pair of a `Map` plus a `{start,end}` could disagree — a late reply extended the range
     * without filling the middle, and nothing ever asked for the hole.
     */
    const [directory, setDirectory] = useState<{ start: number; end: number; items: JsonlEntrySummary[] }>({
        start: 0,
        end: 0,
        items: [],
    });
    const [selected, setSelected] = useState(0);
    const [detail, setDetail] = useState<JsonlEntryDetail | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [chunkLoading, setChunkLoading] = useState(false);
    const [leftWidth, setLeftWidth] = useState(DEFAULT_LEFT_WIDTH);
    const [mode, setMode] = useState<DetailMode>('tree');
    const [jumpValue, setJumpValue] = useState<number | null>(null);
    const [dark, setDark] = useState(isVscodeDarkTheme);

    const [query, setQuery] = useState('');
    const [searching, setSearching] = useState(false);
    const [searchEntries, setSearchEntries] = useState<JsonlEntrySummary[]>([]);
    const [searchMeta, setSearchMeta] = useState<SearchMeta | null>(null);

    const infoRef = useRef<JsonlInfoPayload | null>(null);
    const selectedRef = useRef(0);
    const queryRef = useRef('');
    const rangeSeq = useRef(0);
    /** requestId -> what that request is allowed to do to the window when its reply lands. */
    const rangeMode = useRef(new Map<number, 'replace' | 'append'>());
    const entrySeq = useRef(0);
    const searchSeq = useRef(0);
    const searchTimer = useRef<number | undefined>(undefined);
    const searchAutoSelected = useRef(false);
    const pendingJump = useRef<number | null>(null);

    useEffect(() => { selectedRef.current = selected; }, [selected]);
    useEffect(() => { queryRef.current = query; }, [query]);
    useEffect(() => observeVscodeThemeChange(() => setDark(isVscodeDarkTheme())), []);

    const requestRange = useCallback((start: number, end: number, mode: 'replace' | 'append') => {
        const requestId = ++rangeSeq.current;
        rangeMode.current.set(requestId, mode);
        setChunkLoading(true);
        handler.emit('jsonlIndex', { requestId, start, end });
    }, []);

    const requestEntry = useCallback((index: number) => {
        const requestId = ++entrySeq.current;
        setDetail(null);
        setDetailLoading(true);
        handler.emit('jsonlEntry', { requestId, index });
    }, []);

    const selectEntry = useCallback((index: number) => {
        setSelected(index);
        requestEntry(index);
    }, [requestEntry]);

    /** Load a window of entries around `target`. */
    const recenter = useCallback((target: number, lineCount: number) => {
        const begin = Math.max(0, Math.min(target - 100, Math.max(0, lineCount - JSONL_CHUNK_SIZE)));
        requestRange(begin, begin + JSONL_CHUNK_SIZE, 'replace');
    }, [requestRange]);

    const startSearch = useCallback((text: string) => {
        const trimmed = text.trim();
        const previous = searchSeq.current;
        const requestId = ++searchSeq.current;
        // Tell the host to stop the old scan; ignoring its output would leave it running.
        if (previous) handler.emit('jsonlSearchCancel', { requestId: previous });
        searchAutoSelected.current = false;
        setSearchEntries([]);
        setSearchMeta(null);
        if (!trimmed) return;
        setSearching(true);
        handler.emit('jsonlSearch', { requestId, query: trimmed });
    }, []);

    useEffect(() => {
        handler.on('jsonlInfo', (payload: JsonlInfoPayload) => {
            const previous = infoRef.current;
            const isSameFile = previous?.cacheId === payload.cacheId;
            infoRef.current = payload;
            setInfo(payload);

            let target = selectedRef.current;
            if (!isSameFile) {
                const restored = loadPersisted(payload.cacheId);
                if (restored) {
                    setLeftWidth(restored.left);
                    setMode(restored.mode);
                }
                target = restored?.selected ?? 0;
                setQuery('');
                setSearching(false);
                setSearchEntries([]);
                setSearchMeta(null);
                searchSeq.current++;
            }
            target = Math.max(0, Math.min(payload.lineCount - 1, target));

            setDirectory({ start: 0, end: 0, items: [] });
            setSelected(target);
            recenter(target, payload.lineCount);
            requestEntry(target);

            // the file changed under us: re-run an active search against the new bytes
            const activeQuery = queryRef.current.trim();
            if (activeQuery) startSearch(activeQuery);
        });

        handler.on('jsonlEntries', (payload: JsonlEntriesPayload) => {
            const mode = rangeMode.current.get(payload.requestId);
            if (!mode) return; // a reply nobody is waiting for any more
            rangeMode.current.delete(payload.requestId);
            if (payload.requestId === rangeSeq.current) setChunkLoading(false);
            if (!payload.entries.length) return;

            const end = payload.start + payload.entries.length;
            setDirectory(prev => {
                if (mode === 'replace') return { start: payload.start, end, items: payload.entries };
                // An append is only valid when it continues the window; anything else is
                // stale, and moving `end` would claim rows we never received.
                if (payload.start !== prev.end) return prev;
                return { start: prev.start, end, items: [...prev.items, ...payload.entries] };
            });
        });

        handler.on('jsonlEntryData', (payload: JsonlEntryPayload) => {
            if (payload.requestId !== entrySeq.current) return;
            if (payload.index !== selectedRef.current) return;
            setDetail(payload.entry);
            setDetailLoading(false);
        });

        handler.on('jsonlSearchBatch', (batch: JsonlSearchBatch) => {
            if (batch.requestId !== searchSeq.current) return;
            if (batch.entries.length) {
                setSearchEntries(prev => [...prev, ...batch.entries]);
                if (!searchAutoSelected.current) {
                    searchAutoSelected.current = true;
                    const first = batch.entries[0];
                    if (first) selectEntry(first.index);
                }
            }
            setSearchMeta({
                matches: batch.matches,
                scanned: batch.scanned,
                total: batch.total,
                done: batch.done,
                capped: batch.capped,
            });
            if (batch.done) setSearching(false);
        });

        handler.emit('init');
    }, [recenter, requestEntry, selectEntry, startSearch]);

    const clearSearch = useCallback(() => {
        // Stop the host-side scan instead of letting it run to completion unread.
        if (searching) handler.emit('jsonlSearchCancel', { requestId: searchSeq.current });
        setSearching(false);
        setSearchEntries([]);
        setSearchMeta(null);
        if (info) {
            const target = pendingJump.current ?? selectedRef.current;
            pendingJump.current = null;
            recenter(Math.max(0, Math.min(info.lineCount - 1, target)), info.lineCount);
        }
    }, [info, recenter, searching]);

    const handleQueryChange = useCallback((next: string) => {
        window.clearTimeout(searchTimer.current);
        setQuery(next);
        if (!next.trim()) clearSearch();
    }, [clearSearch]);

    // search: debounce typing (the reset itself happens in the change handler, not here)
    useEffect(() => {
        window.clearTimeout(searchTimer.current);
        const trimmed = query.trim();
        if (!trimmed) return;
        searchTimer.current = window.setTimeout(() => startSearch(trimmed), SEARCH_DEBOUNCE_MS);
        return () => window.clearTimeout(searchTimer.current);
    }, [query, startSearch]);

    useEffect(() => {
        if (!info) return;
        savePersisted(info.cacheId, { left: leftWidth, selected, mode });
    }, [info, leftWidth, selected, mode]);

    const onNeedMore = useCallback(() => {
        if (!info || directory.end >= info.lineCount || chunkLoading) return;
        requestRange(directory.end, Math.min(info.lineCount, directory.end + JSONL_CHUNK_SIZE), 'append');
    }, [info, directory.end, chunkLoading, requestRange]);

    const searchActive = query.trim().length > 0;
    const items = searchActive ? searchEntries : directory.items;

    const jump = useCallback(() => {
        if (!info || jumpValue == null) return;
        const target = Math.min(info.lineCount - 1, Math.max(0, Math.round(jumpValue) - 1));
        if (query.trim()) {
            pendingJump.current = target;
            setQuery('');
            setSelected(target);
            requestEntry(target);
            return;
        }
        if (target < directory.start || target >= directory.end) recenter(target, info.lineCount);
        selectEntry(target);
    }, [info, jumpValue, directory, query, recenter, requestEntry, selectEntry]);

    const banner = useMemo(() => {
        if (!searchActive) return undefined;
        if (searching || (searchMeta && !searchMeta.done)) {
            const percent = searchMeta && searchMeta.total > 0
                ? Math.round((searchMeta.scanned / searchMeta.total) * 100)
                : 0;
            return (
                <div className="jsonl-index__banner">
                    {$t('jsonl.searching', { percent, count: searchMeta?.matches ?? 0 })}
                </div>
            );
        }
        if (!searchMeta) return undefined;
        const label = searchMeta.matches === 1
            ? $t('jsonl.matchCountOne', { count: searchMeta.matches })
            : $t('jsonl.matchCountMany', { count: searchMeta.matches });
        return (
            <div className="jsonl-index__banner">
                {searchMeta.matches === 0
                    ? $t('jsonl.noMatches')
                    : `${label}${searchMeta.capped ? $t('jsonl.cappedSuffix') : ''}`}
            </div>
        );
    }, [searchActive, searching, searchMeta]);

    const themeTokens = useMemo(() => ({
        colorBgContainer: 'transparent',
        colorBgElevated: getVscodeThemeColor('--vscode-editorWidget-background', dark ? '#202020' : '#ffffff'),
        colorBorder: getVscodeThemeColor('--vscode-panel-border', dark ? '#2b2b2b' : '#e5e5e5'),
        colorText: getVscodeThemeColor('--vscode-foreground', dark ? '#cccccc' : '#3b3b3b'),
        colorTextSecondary: getVscodeThemeColor('--vscode-descriptionForeground', dark ? '#9d9d9d' : '#717171'),
        colorPrimary: getVscodeThemeColor('--vscode-button-background', '#0078d4'),
        colorError: getVscodeThemeColor('--vscode-errorForeground', '#f14c4c'),
        colorWarning: getVscodeThemeColor('--vscode-editorWarning-foreground', '#cca700'),
        fontFamily: getVscodeThemeColor('--vscode-font-family', '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'),
        fontSize: Number.parseInt(getVscodeThemeColor('--vscode-font-size', '13px'), 10) || 13,
        controlHeightSM: 22,
        borderRadius: 4,
    }), [dark]);

    const total = info?.lineCount ?? 0;

    return (
        <ConfigProvider
            theme={{ algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm, token: themeTokens }}
        >
            <div className={`jsonl-viewer${dark ? '' : ' jsonl-viewer--light'}`}>
                <div className="jsonl-toolbar">
                    <div className="jsonl-toolbar__left">
                        <span className="jsonl-file-name" title={info?.fileName}>{info?.fileName ?? 'JSONL'}</span>
                        <span className="jsonl-meta">{$t('jsonl.entriesCount', { count: total.toLocaleString() })}</span>
                        <span className="jsonl-dot">·</span>
                        <span className="jsonl-meta">{formatBytes(info?.byteSize ?? 0)}</span>
                    </div>
                    <div className="jsonl-toolbar__right">
                        <Input
                            size="small"
                            allowClear
                            prefix={<SearchOutlined />}
                            placeholder={$t('jsonl.searchPlaceholder')}
                            className="jsonl-search"
                            value={query}
                            onChange={event => handleQueryChange(event.target.value)}
                        />
                        <InputNumber
                            size="small"
                            min={1}
                            max={Math.max(1, total)}
                            value={jumpValue}
                            placeholder={$t('jsonl.jumpPlaceholder')}
                            className="jsonl-jump"
                            onChange={value => setJumpValue(typeof value === 'number' ? value : null)}
                            onPressEnter={jump}
                        />
                        <Button size="small" onClick={jump}>{$t('jsonl.go')}</Button>
                        <Button
                            type="text"
                            size="small"
                            icon={<ReloadOutlined />}
                            title={$t('jsonl.reload')}
                            onClick={() => handler.emit('jsonlReload')}
                        />
                    </div>
                </div>

                <Splitter className="jsonl-splitter" onResize={sizes => setLeftWidth(sizes[0] ?? DEFAULT_LEFT_WIDTH)}>
                    <Splitter.Panel defaultSize={leftWidth} min={240} max={720} className="jsonl-splitter__panel">
                        <JsonlIndex
                            items={items}
                            selected={selected}
                            loading={searchActive ? false : chunkLoading}
                            onSelect={selectEntry}
                            onNeedMore={searchActive ? undefined : onNeedMore}
                            header={banner}
                            highlight={searchActive ? query.trim() : undefined}
                            emptyText={
                                searchActive
                                    ? (searching ? $t('jsonl.searchingShort') : $t('jsonl.noMatches'))
                                    : (chunkLoading ? $t('jsonl.loading') : $t('jsonl.empty'))
                            }
                        />
                    </Splitter.Panel>
                    <Splitter.Panel className="jsonl-splitter__panel">
                        <JsonlDetail
                            key={selected}
                            index={selected}
                            entry={detail}
                            loading={detailLoading}
                            mode={mode}
                            onModeChange={setMode}
                        />
                    </Splitter.Panel>
                </Splitter>
            </div>
        </ConfigProvider>
    );
}
