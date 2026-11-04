import { CopyOutlined, LeftOutlined, ReloadOutlined, RightOutlined } from '@ant-design/icons';
import { Button, InputNumber, Space, Tree, Typography } from 'antd';
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
import './Jsonl.less';

type PathSeg = string | number;

const MAX_CHILDREN = 100;
const MAX_DEPTH = 8;

const makeKey = (parts: PathSeg[]): string => JSON.stringify(parts);
const readKey = (key: React.Key | string): PathSeg[] => JSON.parse(String(key)) as PathSeg[];

function isComposite(value: unknown): value is Record<PathSeg, unknown> | unknown[] {
    return typeof value === 'object' && value !== null;
}

function kindOf(value: unknown): string {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    return typeof value;
}

function preview(value: unknown): string {
    if (value === null) return 'null';
    if (Array.isArray(value)) return `[…] ${value.length} item${value.length === 1 ? '' : 's'}`;
    if (typeof value === 'object') {
        const size = Object.keys(value as object).length;
        return `{…} ${size} key${size === 1 ? '' : 's'}`;
    }
    if (typeof value === 'string') {
        const text = JSON.stringify(value);
        return text.length > 120 ? `${text.slice(0, 120)}…` : text;
    }
    if (typeof value === 'bigint') return `${value}n`;
    return String(value);
}

function previewLine(value: unknown): string {
    if (isComposite(value)) return preview(value);
    return preview(value);
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
                    <span className="jsonl-colon">: </span>
                    <span className={`jsonl-val jsonl-val--${kindOf(child)}`}>{preview(child)}</span>
                </span>
            ),
        });
    }
    if (entries.length > MAX_CHILDREN) {
        nodes.push({
            key: makeKey([...parentKey, '__more__']),
            isLeaf: true,
            selectable: false,
            title: <span className="jsonl-more">… {entries.length - MAX_CHILDREN} more</span>,
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

    const linesRef = useRef(lines);
    const childrenRef = useRef(new Map<string, DataNode[]>());

    useEffect(() => {
        linesRef.current = lines;
    }, [lines]);

    useEffect(() => {
        const measure = () => setViewportHeight(Math.max(240, window.innerHeight - 120));
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
            let title: ReactNode;
            let isLeaf = true;
            if (!line) {
                title = <span className="jsonl-line jsonl-line--pending">L{index + 1} <span className="jsonl-muted">loading…</span></span>;
            } else if (line.empty) {
                title = <span className="jsonl-line jsonl-line--empty">L{index + 1} <span className="jsonl-muted">(empty line)</span></span>;
            } else if (line.error) {
                title = (
                    <span className="jsonl-line jsonl-line--error">
                        L{index + 1} <span className="jsonl-badge jsonl-badge--error">invalid JSON</span>{' '}
                        <span className="jsonl-muted">{line.raw}</span>
                    </span>
                );
            } else if (line.tooLarge) {
                title = (
                    <span className="jsonl-line jsonl-line--warn">
                        L{index + 1} <span className="jsonl-badge jsonl-badge--warn">too large to parse</span>{' '}
                        <span className="jsonl-muted">{formatBytes(line.size)} · {line.raw}</span>
                    </span>
                );
            } else {
                isLeaf = !isComposite(line.value);
                title = (
                    <span className="jsonl-line">
                        L{index + 1} <span className={`jsonl-val jsonl-val--${kindOf(line.value)}`}>{previewLine(line.value)}</span>
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
            // clipboard is unavailable outside a user gesture in some hosts; ignore.
        }
    }, [selection]);

    const total = info?.lineCount ?? 0;
    const windowEnd = Math.min(windowStart + JSONL_WINDOW_SIZE, total);
    const jump = () => {
        if (jumpValue == null) return;
        requestWindow(jumpValue - 1);
    };

    return (
        <div className="jsonl-viewer">
            <div className="jsonl-toolbar">
                <Space size={8} wrap>
                    <Typography.Text strong ellipsis className="jsonl-file-name">
                        {info?.fileName ?? 'JSONL'}
                    </Typography.Text>
                    <span className="jsonl-meta">
                        {total.toLocaleString()} lines · {formatBytes(info?.byteSize ?? 0)}
                    </span>
                </Space>
                <Space size={8}>
                    <Button
                        icon={<LeftOutlined />}
                        size="small"
                        disabled={windowStart === 0 || loading}
                        onClick={() => requestWindow(Math.max(0, windowStart - JSONL_WINDOW_SIZE))}
                    />
                    <span className="jsonl-meta">L{windowStart + 1}–L{windowEnd}</span>
                    <Button
                        icon={<RightOutlined />}
                        size="small"
                        disabled={windowEnd >= total || loading}
                        onClick={() => requestWindow(windowStart + JSONL_WINDOW_SIZE)}
                    />
                    <InputNumber
                        size="small"
                        min={1}
                        max={Math.max(1, total)}
                        value={jumpValue}
                        placeholder="line #"
                        style={{ width: 92 }}
                        onChange={value => setJumpValue(typeof value === 'number' ? value : null)}
                        onPressEnter={jump}
                    />
                    <Button size="small" onClick={jump}>Go</Button>
                    <Button
                        size="small"
                        icon={<ReloadOutlined />}
                        onClick={() => {
                            childrenRef.current.clear();
                            setLoading(true);
                            handler.emit('jsonlReload');
                        }}
                    />
                </Space>
            </div>

            {selection && (
                <div className="jsonl-selection">
                    <span className="jsonl-selection__path">
                        {selection.parts.length === 1
                            ? `L${(selection.parts[0] as number) + 1}`
                            : `L${(selection.parts[0] as number) + 1} › ${selection.parts.slice(1).join(' › ')}`}
                    </span>
                    <span className="jsonl-selection__value">{preview(selection.value)}</span>
                    <Button size="small" type="text" icon={<CopyOutlined />} onClick={() => { void copySelection(); }}>
                        {copied ? 'Copied' : 'Copy value'}
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
                    itemHeight={22}
                    virtual
                    showIcon={false}
                />
            )}
        </div>
    );
}
