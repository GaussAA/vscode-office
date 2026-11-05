import type { DataNode } from 'antd/es/tree';
import type { ReactNode } from 'react';

export type PathSeg = string | number;

export const ROW_HEIGHT = 24;
export const MAX_CHILDREN = 200;
export const MAX_DEPTH = 12;
export const MAX_TREE_NODES = 20000;
/** Above this node count, "expand all" asks for confirmation. */
export const EXPAND_ALL_CONFIRM = 5000;
/** Entries at or below this node count open fully expanded. */
export const AUTO_EXPAND_LIMIT = 300;
/** Default expansion depth for larger entries. */
export const DEFAULT_EXPAND_DEPTH = 2;

export const makePathKey = (path: PathSeg[]): string => JSON.stringify(path);
export const readPathKey = (key: React.Key | string): PathSeg[] => JSON.parse(String(key)) as PathSeg[];

export function isComposite(value: unknown): value is Record<PathSeg, unknown> | unknown[] {
    return typeof value === 'object' && value !== null;
}

export function typeLabel(value: unknown): string {
    if (value === null) return 'null';
    if (Array.isArray(value)) return `array[${value.length}]`;
    const kind = typeof value;
    if (kind === 'object') return `object{${Object.keys(value as object).length}}`;
    return kind;
}

export function typeClass(value: unknown): string {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    if (typeof value === 'object') return 'object';
    return typeof value;
}

export function preview(value: unknown): string {
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

export function formatBytes(size: number): string {
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
    return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** Human-readable path: `a.b[0].c` */
export function pathToText(path: PathSeg[]): string {
    return path.reduce<string>((acc, seg) => {
        if (typeof seg === 'number') return `${acc}[${seg}]`;
        return acc ? `${acc}.${seg}` : seg;
    }, '');
}

function segmentLabel(seg: PathSeg): string {
    return typeof seg === 'number' ? `[${seg}]` : String(seg);
}

export function valueRow(seg: PathSeg, value: unknown): ReactNode {
    const composite = isComposite(value);
    return (
        <span className="jsonl-kv">
            <span className="jsonl-key">{segmentLabel(seg)}</span>
            <span className="jsonl-colon">:</span>
            <span className={`jsonl-val jsonl-val--${typeClass(value)}`}>{preview(value)}</span>
            {composite && <span className="jsonl-type">{typeLabel(value)}</span>}
        </span>
    );
}

export interface BuiltTree {
    nodes: DataNode[];
    /** Every key, in tree order. */
    allKeys: string[];
    /** Keys within DEFAULT_EXPAND_DEPTH, used as the default expansion set. */
    shallowKeys: string[];
    count: number;
    truncated: boolean;
}

/**
 * Build the full antd tree for one entry. Bounded on purpose: a single JSONL
 * line can be tens of MB, and an unbounded tree freezes the webview.
 */
export function buildTree(value: unknown): BuiltTree {
    const allKeys: string[] = [];
    const shallowKeys: string[] = [];
    let count = 0;
    let truncated = false;

    const walk = (current: unknown, path: PathSeg[]): DataNode[] => {
        if (!isComposite(current) || path.length >= MAX_DEPTH) return [];
        const entries: [PathSeg, unknown][] = Array.isArray(current)
            ? current.map((item, index) => [index, item] as [number, unknown])
            : Object.entries(current);
        const visible = entries.slice(0, MAX_CHILDREN);
        const nodes: DataNode[] = [];
        for (const [seg, child] of visible) {
            if (count >= MAX_TREE_NODES) {
                truncated = true;
                break;
            }
            const childPath = [...path, seg];
            const key = makePathKey(childPath);
            count++;
            allKeys.push(key);
            if (childPath.length <= DEFAULT_EXPAND_DEPTH) shallowKeys.push(key);
            const composite = isComposite(child);
            nodes.push({
                key,
                isLeaf: !composite,
                title: valueRow(seg, child),
                children: composite ? walk(child, childPath) : undefined,
            });
        }
        if (entries.length > visible.length) {
            nodes.push({
                key: makePathKey([...path, '__more__']),
                isLeaf: true,
                selectable: false,
                title: <span className="jsonl-more">… {entries.length - visible.length} more keys</span>,
            });
        }
        return nodes;
    };

    const nodes = walk(value, []);
    return { nodes, allKeys, shallowKeys, count, truncated };
}

/** Read the value a tree key points at. */
export function valueAtPath(root: unknown, path: PathSeg[]): unknown {
    let current: unknown = root;
    for (const seg of path) {
        if (!isComposite(current)) return undefined;
        current = (current as Record<PathSeg, unknown>)[seg];
    }
    return current;
}
