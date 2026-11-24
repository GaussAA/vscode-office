/**
 * JSONL tree model: framework-free.
 *
 * This module used to build antd `DataNode`s with JSX titles, which meant the interesting
 * part — how deep, how wide, when to truncate — could only be exercised by bundling React.
 * It now returns plain data; rendering is one adapter in `EntryDetail`.
 *
 * Every single-line preview goes through `preview()`, which reads `SUMMARY_CHARS` from the
 * shared record constants (ADR-0030). There is no wrap mode: all rows are one line and the
 * tree is always a fixed-height virtual list.
 */

import { SUMMARY_CHARS } from "@/common/recordConstants";
import { toDisplayText } from "@/common/displayText";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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

export const makePathKey = (path: PathSeg[]): string => JSON.stringify(path);
// JSON.parse returns `any`; the type assertion is safe because we control the serialization
export const readPathKey = (key: string): PathSeg[] => JSON.parse(String(key)) as PathSeg[];

export function isComposite(value: unknown): value is Record<PathSeg, unknown> | unknown[] {
  return typeof value === "object" && value !== null;
}

/**
 * A composite with nothing to expand. Arrays answer by length; objects stop at the first own
 * key instead of allocating `Object.keys()` for a large one.
 */
export function isEmptyComposite(value: unknown): boolean {
  if (Array.isArray(value)) return value.length === 0;
  if (!isObject(value)) return false;
  for (const key in value) {
    if (Object.prototype.hasOwnProperty.call(value, key)) return false;
  }
  return true;
}

export function typeLabel(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `array[${value.length}]`;
  const kind = typeof value;
  if (isObject(value)) return `object{${Object.keys(value).length}}`;
  return kind;
}

export function typeClass(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return "object";
  return typeof value;
}

/** A high surrogate must be followed by a low one; cutting between them paints a broken glyph. */
function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/** Move a window edge outward so it does not separate a surrogate pair. */
function safeWindowEnd(text: string, start: number, end: number): number {
  return start < end &&
    end < text.length &&
    isHighSurrogate(text.charCodeAt(end - 1)) &&
    isLowSurrogate(text.charCodeAt(end))
    ? end + 1
    : end;
}

/** Move a window start back so it begins at a code point, not at a low surrogate. */
function safeWindowStart(text: string, start: number): number {
  return start > 0 &&
    start < text.length &&
    isLowSurrogate(text.charCodeAt(start)) &&
    isHighSurrogate(text.charCodeAt(start - 1))
    ? start - 1
    : start;
}

/** JSON-escaped body of an already-windowed string; quotes are added by the caller. */
function escapeJsonBody(text: string): string {
  const quoted = JSON.stringify(text);
  return quoted.length >= 2 ? quoted.slice(1, -1) : "";
}

/**
 * The one-line summary of a string value.
 *
 * A long string is cut before it is stringified: `JSON.stringify(value).slice(0, 120)` used to
 * allocate the whole value just to show 120 characters, on every visible row. The marker says
 * how many characters are hidden, so a 121-character string and an 8 MB one are distinguishable.
 * With a search term, the window is centred on the first hit instead of the value's head.
 */
export function stringSummary(text: string, highlight?: string): string {
  const limit = SUMMARY_CHARS;
  if (text.length <= limit) return JSON.stringify(text);
  const count = ` (${text.length.toLocaleString()} chars)`;
  let start = 0;
  if (highlight) {
    const hit = text.toLowerCase().indexOf(highlight.toLowerCase());
    if (hit > 0) start = safeWindowStart(text, Math.max(0, hit - Math.floor(limit / 3)));
  }
  const end = safeWindowEnd(text, start, start + limit);
  const body = escapeJsonBody(text.slice(start, end));
  const lead = start > 0 ? "…" : "";
  const tail = end < text.length ? "…" : "";
  return `"${lead}${body}${tail}"${count}`;
}

/**
 * The first `limit` characters of a raw text line, for the Raw tab and the error bodies.
 * The panel is where the rest is read; this only has to make the value identifiable.
 */
export function summaryHead(
  text: string,
  limit = SUMMARY_CHARS,
): { text: string; truncated: boolean } {
  if (text.length <= limit) return { text, truncated: false };
  return { text: text.slice(0, safeWindowEnd(text, 0, limit)), truncated: true };
}

/**
 * Split the value panel's text into render chunks.
 *
 * The panel is the only full-text channel and may hold up to `VALUE_PANEL_MAX_CHARS`; painting
 * it as one text node costs a layout pass over everything. Chunks stay small, the browser skips
 * off-screen ones (`content-visibility: auto`), and a line longer than one chunk is cut so a
 * minified 1 MB string still becomes several chunks instead of one giant box. Lines are kept
 * intact otherwise, so the chunk boundary falls where a newline already existed.
 */
export function chunkText(text: string, maxChars = 4_000): string[] {
  if (!text) return [];
  const chunks: string[] = [];
  let current: string[] = [];
  let size = 0;
  const flush = () => {
    if (current.length > 0) {
      chunks.push(current.join("\n"));
      current = [];
      size = 0;
    }
  };
  for (const line of text.split("\n")) {
    if (line.length > maxChars) {
      flush();
      let at = 0;
      while (at < line.length) {
        const end = safeWindowEnd(line, at, Math.min(line.length, at + maxChars));
        chunks.push(line.slice(at, end));
        at = end;
      }
      continue;
    }
    current.push(line);
    size += line.length + 1;
    if (size >= maxChars) flush();
  }
  flush();
  return chunks;
}

export function preview(value: unknown, highlight?: string): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "[…]";
  if (typeof value === "object") return "{…}";
  if (typeof value === "string") return stringSummary(value, highlight);
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

/** One row of the detail tree, as data. Rendering lives in `EntryDetail`. */
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
  /** Composite whose children are built on the first expand (lazy tree). */
  lazy?: boolean;
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
}

export interface EntryModelOptions {
  maxChildren?: number;
  maxDepth?: number;
  maxNodes?: number;
  defaultExpandDepth?: number;
  /** Build children only to this depth (relative to `pathPrefix`); deeper composites are lazy. */
  lazyDepth?: number;
  /**
   * Absolute path of the value being built. A lazy node loads its subtree with this set to the
   * node's own path, so child keys stay rooted at the entry and `valueAtPath` still resolves them.
   */
  pathPrefix?: PathSeg[];
  /** Search term; long-string summaries are centred on its first occurrence. */
  highlight?: string;
}

/**
 * Build the full tree for one entry. Bounded on purpose: a single JSONL line can be tens of
 * MB, and an unbounded tree freezes the webview.
 */
export function buildEntryModel(value: unknown, options: EntryModelOptions = {}): EntryModel {
  const maxChildren = options.maxChildren ?? MAX_CHILDREN;
  const maxDepth = options.maxDepth ?? MAX_DEPTH;
  const maxNodes = options.maxNodes ?? MAX_TREE_NODES;
  const defaultExpandDepth = options.defaultExpandDepth ?? DEFAULT_EXPAND_DEPTH;
  const lazyDepth = options.lazyDepth ?? Number.POSITIVE_INFINITY;
  const basePath = options.pathPrefix ?? [];
  const highlight = options.highlight;

  const keys: string[] = [];
  const shallowKeys: string[] = [];
  let count = 0;
  let truncated = false;

  const walk = (current: unknown, path: PathSeg[]): NodeModel[] => {
    if (!isComposite(current) || path.length >= maxDepth) return [];
    const entries: [PathSeg, unknown][] = Array.isArray(current)
      ? current.map((item, index): [number, unknown] => [index, item])
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
      if (childPath.length - basePath.length <= defaultExpandDepth) shallowKeys.push(key);
      const childComposite = isComposite(child);
      // At the cap the node keeps its type badge but must not advertise an expand arrow that
      // opens nothing. Its hidden key count is the honest "… N more keys" suffix.
      const hiddenKeys =
        childComposite && childPath.length >= maxDepth
          ? Array.isArray(child)
            ? child.length
            : isObject(child)
              ? Object.keys(child).length
              : 0
          : 0;
      const capped = hiddenKeys > 0;
      const lazy = childComposite && !capped && childPath.length - basePath.length >= lazyDepth;
      nodes.push({
        key,
        path: childPath,
        label: segmentLabel(seg),
        value: child,
        kind: typeClass(child),
        typeLabel: typeLabel(child),
        preview: preview(child, highlight),
        composite: childComposite && !capped,
        children: childComposite && !capped && !lazy ? walk(child, childPath) : [],
        ...(lazy ? { lazy: true } : {}),
        ...(capped ? { depthCapped: hiddenKeys } : {}),
      });
    }
    if (entries.length > visible.length) {
      nodes.push({
        // Not a JSON path: a real object can contain a "__more__" key, and that collision
        // gave antd two nodes with the same identity.
        key: `__more__:${makePathKey(path)}`,
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

  const nodes = walk(value, basePath);
  return { nodes, keys, shallowKeys, count, truncated, limit: maxNodes };
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

/**
 * Pretty-print `value` but keep only the first `limit` characters, without allocating the
 * full string. `chars` still counts the whole output so the value bar can label the value;
 * the old `JSON.stringify(value, null, 2)` allocated the full text (tens of MB for a large
 * record) just to slice 200k off it, which is what made opening the value panel janky.
 * A circular value falls back to `String(value)`, matching `jsonText`'s catch.
 */
export function jsonTextBounded(value: unknown, limit: number): ValueText {
  let text = "";
  let chars = 0;
  let truncated = false;
  const write = (chunk: string) => {
    chars += chunk.length;
    if (truncated) return;
    if (text.length >= limit) {
      truncated = true;
      return;
    }
    const fitRaw = Math.min(chunk.length, limit - text.length);
    // Keep the cut on a code-point boundary; a lone surrogate paints as a broken glyph.
    const fit =
      fitRaw > 0 &&
      fitRaw < chunk.length &&
      isHighSurrogate(chunk.charCodeAt(fitRaw - 1)) &&
      isLowSurrogate(chunk.charCodeAt(fitRaw))
        ? fitRaw - 1
        : fitRaw;
    text += chunk.slice(0, fit);
    if (fit < chunk.length) truncated = true;
  };
  const seen = new WeakSet<object>();
  const scalar = (v: unknown): void => {
    if (v === null) {
      write("null");
      return;
    }
    switch (typeof v) {
      case "string":
        write(JSON.stringify(v));
        return;
      case "number":
        // JSON has no NaN/Infinity; JSON.stringify emits null for both.
        write(Number.isFinite(v) ? String(v) : "null");
        return;
      case "boolean":
        write(v ? "true" : "false");
        return;
      default:
        // undefined/function/symbol: null in an array, omitted from an object's keys below.
        write("null");
    }
  };
  const emit = (v: unknown, indent: string): void => {
    if (v === null || typeof v !== "object") {
      scalar(v);
      return;
    }
    if (seen.has(v)) throw new Error("circular");
    seen.add(v);
    try {
      if (Array.isArray(v)) {
        if (v.length === 0) {
          write("[]");
          return;
        }
        write("[\n");
        for (let i = 0; i < v.length; i++) {
          write(indent + "  ");
          emit(v[i], indent + "  ");
          if (i < v.length - 1) write(",");
          write("\n");
        }
        write(indent + "]");
        return;
      }
      const record = v as Record<string, unknown>;
      const keys = Object.keys(record).filter((key) => {
        const child = record[key];
        return child !== undefined && typeof child !== "function" && typeof child !== "symbol";
      });
      if (keys.length === 0) {
        write("{}");
        return;
      }
      write("{\n");
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        write(indent + "  " + JSON.stringify(key) + ": ");
        emit(record[key], indent + "  ");
        if (i < keys.length - 1) write(",");
        write("\n");
      }
      write(indent + "}");
    } finally {
      seen.delete(v);
    }
  };
  try {
    emit(value, "");
  } catch {
    const fallback = String(value);
    text = fallback.slice(0, safeWindowEnd(fallback, 0, limit));
    chars = fallback.length;
    truncated = fallback.length > limit;
  }
  return { text, chars, truncated };
}

export function fullValueText(value: unknown, limit: number): ValueText {
  if (typeof value === "string") {
    if (value.length <= limit) return { text: value, chars: value.length, truncated: false };
    return {
      text: value.slice(0, safeWindowEnd(value, 0, limit)),
      chars: value.length,
      truncated: true,
    };
  }
  try {
    return jsonTextBounded(value, limit);
  } catch {
    return { text: String(value), chars: String(value).length, truncated: false };
  }
}

/** Read the value a tree key points at. */
export function valueAtPath(root: unknown, path: PathSeg[]): unknown {
  let current: unknown = root;
  for (const seg of path) {
    if (!isComposite(current)) return undefined;
    // isComposite guarantees current is an object or array, both support bracket notation
    if (Array.isArray(current) && typeof seg === "number") {
      current = current[seg];
    } else if (isObject(current) && typeof seg === "string") {
      current = current[seg];
    } else {
      return undefined;
    }
  }
  return current;
}
