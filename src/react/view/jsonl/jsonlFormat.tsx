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
/** Entries at or below this node count render with wrapping (virtual scrolling off). */
export const WRAP_NODE_LIMIT = 500;
/** Strings longer than this are cut even in wrap mode. */
export const WRAP_TEXT_LIMIT = 2000;

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

function wrappedText(text: string): string {
    return text.length <= WRAP_TEXT_LIMIT ? text : `${text.slice(0, WRAP_TEXT_LIMIT)}… (${text.length.toLocaleString()} chars)`;
}

export function valueRow(seg: PathSeg, value: unknown, wrap = false): ReactNode {
    const composite = isComposite(value);
    const longString = wrap && typeof value === 'string';
    const text = longString ? wrappedText(value as string) : preview(value);
    return (
        <span className={`jsonl-kv${wrap ? ' jsonl-kv--wrap' : ''}`}>
            <span className="jsonl-key">{segmentLabel(seg)}</span>
            <span className="jsonl-colon">:</span>
            <span className={`jsonl-val jsonl-val--${typeClass(value)}${longString ? ' jsonl-val--wrap' : ''}`}>{text}</span>
            {composite && <span className="jsonl-type">{typeLabel(value)}</span>}
        </span>
    );
}

/** Cheap node count used to decide whether wrapping is affordable. */
export function countNodes(value: unknown, limit = WRAP_NODE_LIMIT): number {
    let count = 0;
    let capped = false;
    const walk = (current: unknown, depth: number) => {
        if (capped || !isComposite(current) || depth >= MAX_DEPTH) return;
        const entries = Array.isArray(current) ? current : Object.values(current);
        for (const child of entries) {
            if (count >= limit) {
                capped = true;
                return;
            }
            count++;
            walk(child, depth + 1);
        }
    };
    walk(value, 0);
    // limit + 1 marks "too many"; returning exactly limit would read as "just fits"
    return capped ? limit + 1 : count;
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
export function buildTree(value: unknown, wrap = false): BuiltTree {
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
                title: valueRow(seg, child, wrap),
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

/** Split text into plain / matched runs for search highlighting. */
export function highlightParts(text: string, needle?: string): Array<{ text: string; hit: boolean }> {
    if (!needle) return [{ text, hit: false }];
    const lower = text.toLowerCase();
    const query = needle.toLowerCase();
    const parts: Array<{ text: string; hit: boolean }> = [];
    let cursor = 0;
    while (cursor < text.length && parts.length < 40) {
        const at = lower.indexOf(query, cursor);
        if (at < 0) break;
        if (at > cursor) parts.push({ text: text.slice(cursor, at), hit: false });
        parts.push({ text: text.slice(at, at + query.length), hit: true });
        cursor = at + query.length;
    }
    if (cursor < text.length) parts.push({ text: text.slice(cursor), hit: false });
    return parts.length ? parts : [{ text, hit: false }];
}


