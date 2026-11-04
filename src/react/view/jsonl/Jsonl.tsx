import { CopyOutlined, LeftOutlined, ReloadOutlined, RightOutlined } from '@ant-design/icons';
import { Button, ConfigProvider, InputNumber, Tree, Typography, theme as antdTheme } from 'antd';
import type { DataNode } from 'antd/es/tree';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
    JSONL_WINDOW_SIZE,
    type JsonlInfoPayload,
    type JsonlLinePayload,
    type JsonlLinesPayload,
} from '../../../common/jsonlTypes.ts';
import { handler } from '../../util/vscode.ts';
import {
    getVscodeThemeColor,
    isVscodeDarkTheme,
    observeVscodeThemeChange,
} from '../../util/vscodeTheme.ts';
import './Jsonl.less';

type PathSeg = string | number;

const MAX_CHILDREN = 100;
const MAX_DEPTH = 8;
const ROW_HEIGHT = 24;

const makeKey = (parts: PathSeg[]): string => JSON.stringify(parts);
const readKey = (key: React.Key | string): PathSeg[] => JSON.parse(String(key)) as PathSeg[];

function isComposite(value: unknown): value is Record<PathSeg, unknown> | unknown[] {
    return typeof value === 'object' && value !== null;
}

/** Short type label shown as a chip on each line / value. */
function typeLabel(value: unknown): string {
    if (value === null) return 'null';
    if (Array.isArray(value)) return `array[${value.length}]`;
    const kind = typeof value;
    if (kind === 'object') return `object{${Object.keys(value as object).length}}`;
    return kind;
}

function typeClass(value: unknown): string {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    if (typeof value === 'object') return 'object';
    return typeof value;
}

function preview(value: unknown): string {
    if (value === null) return 'null';
    if (Array.isArray(value)) return '[…]';
    if (typeof value === 'object') return '{…}';
    if (typeof value === 'string') {
        const text = JSON.stringify(value);
        return text.length > 120 ? `${text.slice(0, 120)}…` : text;
    }
    if (typeof value === 'bigint') return `${value}n`;
    return String(value);
}

/** One-line raw preview used for the line node: the collapsed JSON itself. */
function rawPreview(line: JsonlLinePayload): string {
    const text = line.raw.replace(/\s+/g, ' ').trim();
    if (!text) return '';
    return text.length > 160 ? `${text.slice(0, 160)}…` : text;
}

function resolvePath(root: unknown, path: PathSeg[]): unknown {
    let current: unknown = root;
    for (const seg of path) {
        if (!isComposite(current)) return undefined;
        current = (current as Record<PathSeg, unknown>)[seg];
    }
    return current;
}

function buildChildren(parentKey: PathSeg[], value: unknown, depth: number): DataNode[] {
    if (!isComposite(value) || depth > MAX_DEPTH) return [];
    const entries: [PathSeg, unknown][] = Array.isArray(value)
        ? value.map((item, index) => [index, item] as [number, unknown])
        : Object.entries(value);
    const nodes: DataNode[] = [];
    for (const [seg, child] of entries.slice(0, MAX_CHILDREN)) {
        const composite = isComposite(child);
        nodes.push({
            key: makeKey([...parentKey, seg]),
            isLeaf: !composite,
            title: (
                <span className="jsonl-kv">
                    <span className="jsonl-key">{Array.isArray(value) ? `[${seg}]` : String(seg)}</span>
                    <span className="jsonl-colon">:</span>
                    <span className={`jsonl-val jsonl-val--${typeClass(child)}`}>{preview(child)}</span>
                    {composite && <span className="jsonl-type">{typeLabel(child)}</span>}
                </span>
            ),
        });
    }
    if (entries.length > MAX_CHILDREN) {
        nodes.push({
            key: makeKey([...parentKey, '__more__']),
            isLeaf: true,
            selectable: false,
            title: <span className="jsonl-more">… {entries.length - MAX_CHILDREN} more keys</span>,
        });
    }
    return nodes;
}

function attachChildren(nodes: DataNode[], cache: Map<string, DataNode[]>): DataNode[] {
    return nodes.map(node => {
        const children = cache.get(String(node.key));
        return children ? { ...node, children: attachChildren(children, cache) } : node;
    });
}

function formatBytes(size: number): string {
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
    return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export default function JsonlViewer() {
    const [info, setInfo] = useState<JsonlInfoPayload | null>(null);
    const [lines, setLines] = useState<Map<number, JsonlLinePayload>>(() => new Map());
    const [windowStart, setWindowStart] = useState(0);
    const [jumpValue, setJumpValue] = useState<number | null>(null);
    const [selection, setSelection] = useState<{ parts: PathSeg[]; value: unknown } | null>(null);
    const [copied, setCopied] = useState(false);
    const [loading, setLoading] = useState(true);
    const [version, setVersion] = useState(0);
    const [viewportHeight, setViewportHeight] = useState(480);
    const [dark, setDark] = useState(isVscodeDarkTheme);

    const linesRef = useRef(lines);
    const childrenRef = useRef(new Map<string, DataNode[]>());

    useEffect(() => {
        linesRef.current = lines;
    }, [lines]);

    useEffect(() => observeVscodeThemeChange(() => setDark(isVscodeDarkTheme())), []);

    useEffect(() => {
        const measure = () => setViewportHeight(Math.max(200, window.innerHeight - 84));
        measure();
        window.addEventListener('resize', measure);
        return () => window.removeEventListener('resize', measure);
    }, []);

    useEffect(() => {
        handler.on('jsonlInfo', (payload: JsonlInfoPayload) => {
            childrenRef.current.clear();
            setInfo(payload);
            setLines(new Map());
            setSelection(null);
            setWindowStart(0);
            setLoading(true);
            handler.emit('jsonlRead', { start: 0, end: JSONL_WINDOW_SIZE });
        });
        handler.on('jsonlLines', (payload: JsonlLinesPayload) => {
            childrenRef.current.clear();
            setLines(prev => {
                const next = new Map(prev);
                for (const line of payload.lines) next.set(line.index, line);
                return next;
            });
            setLoading(false);
            setVersion(v => v + 1);
        });
        handler.emit('init');
    }, []);

    const requestWindow = useCallback((start: number) => {
        const total = info?.lineCount ?? 0;
        const clamped = Math.max(0, Math.min(start, Math.max(0, total - 1)));
        childrenRef.current.clear();
        setWindowStart(clamped);
        setLoading(true);
        handler.emit('jsonlRead', { start: clamped, end: clamped + JSONL_WINDOW_SIZE });
    }, [info?.lineCount]);

    const loadData = useCallback(async (node: DataNode) => {
        const key = String(node.key);
        if (childrenRef.current.has(key)) return;
        const parts = readKey(key);
        const line = linesRef.current.get(parts[0] as number);
        let children: DataNode[] = [];
        if (line && line.value !== undefined) {
            const value = parts.length === 1 ? line.value : resolvePath(line.value, parts.slice(1));
            children = buildChildren(parts, value, parts.length);
        }
        childrenRef.current.set(key, children);
        setVersion(v => v + 1);
    }, []);

    const treeData = useMemo<DataNode[]>(() => {
        if (!info) return [];
        const end = Math.min(windowStart + JSONL_WINDOW_SIZE, info.lineCount);
        const roots: DataNode[] = [];
        for (let index = windowStart; index < end; index++) {
            const line = lines.get(index);
            const lineKey = makeKey([index]);
            const lineno = <span className="jsonl-lineno">{index + 1}</span>;
            let title: ReactNode;
            let isLeaf = true;
            if (!line) {
                title = <span className="jsonl-row jsonl-row--pending"><span className="jsonl-muted">loading…</span>{lineno}</span>;
            } else if (line.empty) {
                title = <span className="jsonl-row jsonl-row--empty"><span className="jsonl-type">empty</span>{lineno}</span>;
            } else if (line.error) {
                title = (
                    <span className="jsonl-row jsonl-row--error">
                        <span className="jsonl-chip jsonl-chip--error">invalid JSON</span>
                        <span className="jsonl-raw">{rawPreview(line)}</span>
                        {lineno}
                    </span>
                );
            } else if (line.tooLarge) {
                title = (
                    <span className="jsonl-row jsonl-row--warn">
                        <span className="jsonl-chip jsonl-chip--warn">too large</span>
                        <span className="jsonl-muted">{formatBytes(line.size)}</span>
                        <span className="jsonl-raw">{rawPreview(line)}</span>
                        {lineno}
                    </span>
                );
            } else {
                isLeaf = !isComposite(line.value);
                title = (
                    <span className="jsonl-row">
                        <span className={`jsonl-chip jsonl-chip--${typeClass(line.value)}`}>{typeLabel(line.value)}</span>
                        <span className="jsonl-raw">{rawPreview(line)}</span>
                        {lineno}
                    </span>
                );
            }
            const cached = childrenRef.current.get(lineKey);
            roots.push({
                key: lineKey,
                title,
                isLeaf,
                children: cached ? attachChildren(cached, childrenRef.current) : undefined,
            });
        }
        return roots;
    }, [info, lines, windowStart, version]);

    const onSelect = useCallback((keys: React.Key[]) => {
        const key = keys[0];
        if (key === undefined) {
            setSelection(null);
            return;
        }
        const parts = readKey(key);
        const line = linesRef.current.get(parts[0] as number);
        const value = parts.length === 1 ? line?.value : resolvePath(line?.value, parts.slice(1));
        setSelection({ parts, value });
    }, []);

    const copySelection = useCallback(async () => {
        if (!selection) return;
        const { value } = selection;
        const text = typeof value === 'string' ? value : (() => {
            try {
                return JSON.stringify(value, null, 2) ?? String(value);
            } catch {
                return String(value);
            }
        })();
        try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1200);
        } catch {
            // clipboard may be unavailable; ignore.
        }
    }, [selection]);

    const total = info?.lineCount ?? 0;
    const windowEnd = Math.min(windowStart + JSONL_WINDOW_SIZE, total);
    const jump = () => {
        if (jumpValue == null) return;
        requestWindow(jumpValue - 1);
    };

    const selectionPath = selection
        ? selection.parts.length === 1
            ? `L${(selection.parts[0] as number) + 1}`
            : `L${(selection.parts[0] as number) + 1} › ${selection.parts.slice(1).join(' › ')}`
        : '';

    return (
        <ConfigProvider
            theme={{
                algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
                token: {
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
                },
            }}
        >
            <div className={`jsonl-viewer${dark ? '' : ' jsonl-viewer--light'}`}>
                <div className="jsonl-toolbar">
                    <div className="jsonl-toolbar__left">
                        <span className="jsonl-file-name" title={info?.fileName}>{info?.fileName ?? 'JSONL'}</span>
                        <span className="jsonl-meta">{total.toLocaleString()} lines</span>
                        <span className="jsonl-dot">·</span>
                        <span className="jsonl-meta">{formatBytes(info?.byteSize ?? 0)}</span>
                    </div>
                    <div className="jsonl-toolbar__right">
                        <Button
                            type="text"
                            size="small"
                            icon={<LeftOutlined />}
                            disabled={windowStart === 0 || loading}
                            onClick={() => requestWindow(Math.max(0, windowStart - JSONL_WINDOW_SIZE))}
                        />
                        <span className="jsonl-meta jsonl-range">L{windowStart + 1}–{windowEnd}</span>
                        <Button
                            type="text"
                            size="small"
                            icon={<RightOutlined />}
                            disabled={windowEnd >= total || loading}
                            onClick={() => requestWindow(windowStart + JSONL_WINDOW_SIZE)}
                        />
                        <InputNumber
                            size="small"
                            min={1}
                            max={Math.max(1, total)}
                            value={jumpValue}
                            placeholder="line #"
                            className="jsonl-jump"
                            onChange={value => setJumpValue(typeof value === 'number' ? value : null)}
                            onPressEnter={jump}
                        />
                        <Button size="small" onClick={jump}>Go</Button>
                        <Button
                            type="text"
                            size="small"
                            icon={<ReloadOutlined />}
                            onClick={() => {
                                childrenRef.current.clear();
                                setLoading(true);
                                handler.emit('jsonlReload');
                            }}
                        />
                    </div>
                </div>

                {selection && (
                    <div className="jsonl-selection">
                        <span className="jsonl-selection__path">{selectionPath}</span>
                        <span className="jsonl-selection__value">{preview(selection.value)}</span>
                        <Button size="small" type="text" icon={<CopyOutlined />} onClick={() => { void copySelection(); }}>
                            {copied ? 'Copied' : 'Copy'}
                        </Button>
                    </div>
                )}

                {!info ? (
                    <div className="jsonl-empty">Loading…</div>
                ) : total === 0 ? (
                    <div className="jsonl-empty">Empty file</div>
                ) : (
                    <Tree
                        className="jsonl-tree"
                        treeData={treeData}
                        loadData={loadData}
                        onSelect={onSelect}
                        height={viewportHeight}
                        itemHeight={ROW_HEIGHT}
                        virtual
                        showIcon={false}
                    />
                )}
            </div>
        </ConfigProvider>
    );
}

