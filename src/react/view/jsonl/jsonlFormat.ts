/**
 * JSONL tree model: framework-free.
 *
 * This module used to build antd `DataNode`s with JSX titles, which meant the interesting
 * part — how deep, how wide, when to truncate, whether to wrap — could only be exercised by
 * bundling React. It now returns plain data; rendering is one adapter in `JsonlDetail`.
 */

import { JSONL_VALUE_TEXT_LIMIT } from "@/common/jsonlTypes";
import { toDisplayText } from "@/common/displayText";

export type PathSeg = string | number;

/**
 * One tree row, including its 1px top and bottom margin. The virtual list positions rows by
 * this number, so it has to equal the CSS pitch: `--jl-row-height` plus the two margins.
 * It was 24 while the CSS produced 28, which made the last ~1/7 of every long tree
 * unreachable — the scrollbar stopped before rows the virtual list had never rendered.
 */
export const ROW_HEIGHT = 28;
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
export const readPathKey = (key: string): PathSeg[] => JSON.parse(String(key)) as PathSeg[];

export function isComposite(value: unknown): value is Record<PathSeg, unknown> | unknown[] {
  return typeof value === "object" && value !== null;
}

export function typeLabel(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `array[${value.length}]`;
  const kind = typeof value;
  if (kind === "object") return `object{${Object.keys(value as object).length}}`;
  return kind;
}

export function typeClass(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return "object";
  return typeof value;
}

export function preview(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "[…]";
  if (typeof value === "object") return "{…}";
  if (typeof value === "string") {
    const text = JSON.stringify(value);
    return text.length > 120 ? `${text.slice(0, 120)}…` : text;
  }
  if (typeof value === "bigint") return `${value}n`;
  return toDisplayText(value);
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
    if (typeof seg === "number") return `${acc}[${seg}]`;
    return acc ? `${acc}.${seg}` : seg;
  }, "");
}

function segmentLabel(seg: PathSeg): string {
  return typeof seg === "number" ? `[${seg}]` : String(seg);
}

function wrappedText(text: string, limit: number): string {
  return text.length <= limit
    ? text
    : `${text.slice(0, limit)}… (${text.length.toLocaleString()} chars)`;
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

/** One row of the detail tree, as data. Rendering lives in `JsonlDetail`. */
export interface NodeModel {
  key: string;
  path: PathSeg[];
  /** Key or index shown in the row. */
  label: string;
  value: unknown;
  /** `typeClass(value)` — drives the CSS modifier. */
  kind: string;
  /** `typeLabel(value)` — the chip after composite values. */
  typeLabel: string;
  preview: string;
  composite: boolean;
  children: NodeModel[];
  /** Set on the synthetic "N more keys" row; such a row is not selectable. */
  overflow?: number;
  /**
   * Key count hidden by `MAX_DEPTH`. The node becomes a leaf (no dead expand arrow) and the
   * row says how many keys are below the cap.
   */
  depthCapped?: number;
}

export interface EntryModel {
  nodes: NodeModel[];
  /** Every key, in tree order. */
  keys: string[];
  /** Keys within DEFAULT_EXPAND_DEPTH, used as the default expansion set. */
  shallowKeys: string[];
  count: number;
  truncated: boolean;
  /** The node cap that produced `truncated`; the tree renders it as a notice row. */
  limit: number;
  /**
   * Whether to render this entry with wrapping. Decided here, by the same walk that builds
   * the tree, so callers no longer have to call `countNodes` first and then `buildTree`.
   */
  wrap: boolean;
}

export interface EntryModelOptions {
  maxChildren?: number;
  maxDepth?: number;
  maxNodes?: number;
  wrapNodeLimit?: number;
  wrapTextLimit?: number;
  defaultExpandDepth?: number;
}

/**
 * Build the full tree for one entry. Bounded on purpose: a single JSONL line can be tens of
 * MB, and an unbounded tree freezes the webview.
 */
export function buildEntryModel(value: unknown, options: EntryModelOptions = {}): EntryModel {
  const maxChildren = options.maxChildren ?? MAX_CHILDREN;
  const maxDepth = options.maxDepth ?? MAX_DEPTH;
  const maxNodes = options.maxNodes ?? MAX_TREE_NODES;
  const wrapNodeLimit = options.wrapNodeLimit ?? WRAP_NODE_LIMIT;
  const wrapTextLimit = options.wrapTextLimit ?? WRAP_TEXT_LIMIT;
  const defaultExpandDepth = options.defaultExpandDepth ?? DEFAULT_EXPAND_DEPTH;

  const composite = isComposite(value);
  const wrap = composite && countNodes(value, wrapNodeLimit) <= wrapNodeLimit;

  const keys: string[] = [];
  const shallowKeys: string[] = [];
  let count = 0;
  let truncated = false;

  const walk = (current: unknown, path: PathSeg[]): NodeModel[] => {
    if (!isComposite(current) || path.length >= maxDepth) return [];
    const entries: [PathSeg, unknown][] = Array.isArray(current)
      ? current.map((item, index) => [index, item] as [number, unknown])
      : Object.entries(current);
    const visible = entries.slice(0, maxChildren);
    const nodes: NodeModel[] = [];
    for (const [seg, child] of visible) {
      if (count >= maxNodes) {
        truncated = true;
        break;
      }
      const childPath = [...path, seg];
      const key = makePathKey(childPath);
      count++;
      keys.push(key);
      if (childPath.length <= defaultExpandDepth) shallowKeys.push(key);
      const childComposite = isComposite(child);
      // At the cap the node keeps its type badge but must not advertise an expand arrow that
      // opens nothing. Its hidden key count is the honest "… N more keys" suffix.
      const hiddenKeys =
        childComposite && childPath.length >= maxDepth
          ? Array.isArray(child)
            ? child.length
            : Object.keys(child as object).length
          : 0;
      const capped = hiddenKeys > 0;
      nodes.push({
        key,
        path: childPath,
        label: segmentLabel(seg),
        value: child,
        kind: typeClass(child),
        typeLabel: typeLabel(child),
        preview:
          wrap && typeof child === "string" ? wrappedText(child, wrapTextLimit) : preview(child),
        composite: childComposite && !capped,
        children: childComposite && !capped ? walk(child, childPath) : [],
        ...(capped ? { depthCapped: hiddenKeys } : {}),
      });
    }
    if (entries.length > visible.length) {
      nodes.push({
        key: makePathKey([...path, "__more__"]),
        path: [...path, "__more__"],
        label: "",
        value: undefined,
        kind: "muted",
        typeLabel: "",
        preview: "",
        composite: false,
        children: [],
        overflow: entries.length - visible.length,
      });
    }
    return nodes;
  };

  const nodes = walk(value, []);
  return { nodes, keys, shallowKeys, count, truncated, limit: maxNodes, wrap };
}

/**
 * Text for the selection panel. Strings are shown as their content, not as a quoted literal:
 * a log line or a prompt is read, not parsed. Everything else is pretty-printed, so a nested
 * object is legible without expanding it node by node.
 *
 * Bounded on purpose. `Copy value` copies the whole thing; this only bounds what is laid out
 * as DOM text, which is the expensive half on a multi-megabyte string.
 */
export interface ValueText {
  text: string;
  /** Characters in the whole value, before the panel cap. */
  chars: number;
  truncated: boolean;
}

export function jsonText(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

export function fullValueText(value: unknown, limit = JSONL_VALUE_TEXT_LIMIT): ValueText {
  const text = jsonText(value);
  const chars = text.length;
  if (chars <= limit) return { text, chars, truncated: false };
  return { text: text.slice(0, limit), chars, truncated: true };
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
