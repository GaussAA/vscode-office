import { ConfigProvider, InputNumber, Splitter, Button, theme as antdTheme } from 'antd';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ReloadOutlined } from '@ant-design/icons';
import {
    JSONL_CHUNK_SIZE,
    type JsonlEntriesPayload,
    type JsonlEntryDetail,
    type JsonlEntryPayload,
    type JsonlEntrySummary,
    type JsonlInfoPayload,
} from '../../../common/jsonlTypes.ts';
import { handler } from '../../util/vscode.ts';
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

interface PersistedState {
    left: number;
    selected: number;
    mode: DetailMode;
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
    const [entries, setEntries] = useState<Map<number, JsonlEntrySummary>>(() => new Map());
    const [loaded, setLoaded] = useState<{ start: number; end: number }>({ start: 0, end: 0 });
    const [selected, setSelected] = useState(0);
    const [detail, setDetail] = useState<JsonlEntryDetail | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [leftWidth, setLeftWidth] = useState(DEFAULT_LEFT_WIDTH);
    const [mode, setMode] = useState<DetailMode>('tree');
    const [jumpValue, setJumpValue] = useState<number | null>(null);
    const [dark, setDark] = useState(isVscodeDarkTheme);

    const infoRef = useRef<JsonlInfoPayload | null>(null);
    const selectedRef = useRef(0);
    const requestKind = useRef<'initial' | 'append'>('initial');

    useEffect(() => { selectedRef.current = selected; }, [selected]);
    useEffect(() => observeVscodeThemeChange(() => setDark(isVscodeDarkTheme())), []);

    const requestRange = useCallback((start: number, end: number) => {
        handler.emit('jsonlIndex', { start, end });
    }, []);

    const requestEntry = useCallback((index: number) => {
        setDetail(null);
        setDetailLoading(true);
        handler.emit('jsonlEntry', index);
    }, []);

    const selectEntry = useCallback((index: number) => {
        setSelected(index);
        requestEntry(index);
    }, [requestEntry]);

    /** Load a window of entries around `target` and select it. */
    const recenter = useCallback((target: number, lineCount: number) => {
        requestKind.current = 'initial';
        const begin = Math.max(0, Math.min(target - 100, Math.max(0, lineCount - JSONL_CHUNK_SIZE)));
        requestRange(begin, begin + JSONL_CHUNK_SIZE);
    }, [requestRange]);

    useEffect(() => {
        handler.on('jsonlInfo', (payload: JsonlInfoPayload) => {
            const previous = infoRef.current;
            const isSameFile = previous?.cacheId === payload.cacheId;
            infoRef.current = payload;
            setInfo(payload);

            let target = selectedRef.current;
            let restored: PersistedState | null = null;
            if (!isSameFile) {
                restored = loadPersisted(payload.cacheId);
                if (restored) {
                    setLeftWidth(restored.left);
                    setMode(restored.mode);
                }
                target = restored?.selected ?? 0;
            }
            target = Math.max(0, Math.min(payload.lineCount - 1, target));

            setEntries(new Map());
            setSelected(target);
            recenter(target, payload.lineCount);
            requestEntry(target);
        });

        handler.on('jsonlEntries', (payload: JsonlEntriesPayload) => {
            if (!payload.entries.length) return;
            setEntries(prev => {
                const next = new Map(prev);
                for (const entry of payload.entries) next.set(entry.index, entry);
                return next;
            });
            const end = payload.start + payload.entries.length;
            setLoaded(prev => (requestKind.current === 'append'
                ? { start: prev.start, end }
                : { start: payload.start, end }));
            requestKind.current = 'append';
        });

        handler.on('jsonlEntryData', (payload: JsonlEntryPayload) => {
            if (payload.index !== selectedRef.current) return;
            setDetail(payload.entry);
            setDetailLoading(false);
        });

        handler.emit('init');
    }, [recenter, requestEntry]);

    useEffect(() => {
        if (!info) return;
        savePersisted(info.cacheId, { left: leftWidth, selected, mode });
    }, [info, leftWidth, selected, mode]);

    const onNeedMore = useCallback(() => {
        if (!info || loaded.end >= info.lineCount) return;
        requestKind.current = 'append';
        requestRange(loaded.end, Math.min(info.lineCount, loaded.end + JSONL_CHUNK_SIZE));
    }, [info, loaded.end, requestRange]);

    const jump = useCallback(() => {
        if (!info || jumpValue == null) return;
        const target = Math.min(info.lineCount - 1, Math.max(0, Math.round(jumpValue) - 1));
        if (target < loaded.start || target >= loaded.end) {
            recenter(target, info.lineCount);
        }
        selectEntry(target);
    }, [info, jumpValue, loaded, recenter, selectEntry]);

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
                        <span className="jsonl-meta">{total.toLocaleString()} entries</span>
                        <span className="jsonl-dot">·</span>
                        <span className="jsonl-meta">{formatBytes(info?.byteSize ?? 0)}</span>
                    </div>
                    <div className="jsonl-toolbar__right">
                        <InputNumber
                            size="small"
                            min={1}
                            max={Math.max(1, total)}
                            value={jumpValue}
                            placeholder="entry #"
                            className="jsonl-jump"
                            onChange={value => setJumpValue(typeof value === 'number' ? value : null)}
                            onPressEnter={jump}
                        />
                        <Button size="small" onClick={jump}>Go</Button>
                        <Button
                            type="text"
                            size="small"
                            icon={<ReloadOutlined />}
                            title="Reload from disk"
                            onClick={() => handler.emit('jsonlReload')}
                        />
                    </div>
                </div>

                <Splitter className="jsonl-splitter" onResize={sizes => setLeftWidth(sizes[0] ?? DEFAULT_LEFT_WIDTH)}>
                    <Splitter.Panel defaultSize={leftWidth} min={240} max={720} className="jsonl-splitter__panel">
                        <JsonlIndex
                            entries={entries}
                            loadedStart={loaded.start}
                            loadedEnd={loaded.end}
                            lineCount={total}
                            selected={selected}
                            loading={detailLoading}
                            onSelect={selectEntry}
                            onNeedMore={onNeedMore}
                        />
                    </Splitter.Panel>
                    <Splitter.Panel className="jsonl-splitter__panel">
                        <JsonlDetail
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
