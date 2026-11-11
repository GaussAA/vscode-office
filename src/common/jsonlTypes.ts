/**
 * Wire format shared by the extension host and the JSONL webview.
 *
 * The host owns the bytes and the line index; the webview only ever receives
 * parsed payloads. Nothing here may import `vscode` — the webview bundle
 * imports it too.
 *
 * Two request/response pairs, deliberately separate:
 *  - `jsonlIndex`  → `jsonlEntries` : light summaries for the left directory pane.
 *  - `jsonlEntry`  → `jsonlEntryData`: the full parsed value of ONE entry, for the
 *    right detail pane. Keeping them apart means scrolling the directory never
 *    ships hundreds of full JSON documents to the webview.
 */

/**
 * A line larger than this is not parsed; it is shown as raw text instead.
 *
 * This used to be 512 KB, which is smaller than one realistic tool-schema record: a real
 * 6.4 MB, 50-line agent transcript contains a 541 KB line (`openclaw.jsonl`), and the
 * viewer refused it. The tree model is already bounded (20k nodes, 200 children per level,
 * depth 12), so the cap only has to keep `JSON.parse` and the postMessage payload finite.
 */
export const JSONL_MAX_LINE_BYTES = 8 * 1024 * 1024;

/**
 * Bytes, not lines, bound a directory window. A line window of 500 huge records used to read
 * and `JSON.parse` all of them before the first row appeared; the budget stops that. The
 * caller passes `anchor` so the selected row is still guaranteed a place in the window.
 */
export const JSONL_RANGE_BYTE_BUDGET = 4 * 1024 * 1024;

/** Entries are streamed into the directory pane in chunks of this size. */
export const JSONL_CHUNK_SIZE = 500;

/** Bytes decoded per search turn, in addition to the line step. */
export const JSONL_SEARCH_BYTE_BUDGET = 8 * 1024 * 1024;

/** Top-level keys tried, in order, when deriving a human-friendly label. */
export const JSONL_LABEL_KEYS = [
  "id",
  "_id",
  "uuid",
  "key",
  "name",
  "title",
  "ts",
  "timestamp",
  // Agent transcripts often carry the actual human query here instead of in `id`.
  "query_search",
] as const;

/** How many characters of the raw line are kept for previews. */
export const JSONL_RAW_PREVIEW_CHARS = 400;

/** Upper bound for the full text shipped to the raw view. */
export const JSONL_MAX_TEXT_CHARS = 1_000_000;

/** Upper bound for the selection panel's text; `Copy value` still copies the whole value. */
export const JSONL_VALUE_TEXT_LIMIT = 200_000;

export interface JsonlInfoPayload {
  fileName: string;
  /** Stable identity for state persistence (scheme + uri). */
  cacheId: string;
  lineCount: number;
  byteSize: number;
}

export interface JsonlRangeRequest {
  /** Echoed back on the reply, so the webview can drop a stale window. */
  requestId: number;
  start: number;
  end: number;
  /**
   * Line that must be inside the reply even when the byte budget would cut before it.
   * `recenter` passes the selected line; plain appends omit it.
   */
  anchor?: number;
}

/**
 * One directory row.
 *
 * A line is exactly one of four things, and both renderers used to re-derive that from five
 * optional booleans, in an order that only existed inside their JSX. It is a discriminated
 * union now: adding a fifth kind is a compile error at every switch instead of a silent
 * fall-through to the `else` branch.
 */
interface JsonlEntryBase {
  /** Zero-based line index. */
  index: number;
  /** Byte length of the line, excluding the newline. */
  size: number;
  /** Truncated raw text, for the directory preview. */
  raw: string;
  /** Search-only: a window of text around the match, instead of the line's head. */
  snippet?: string;
}

export type JsonlEntrySummary =
  | (JsonlEntryBase & { kind: "empty" })
  | (JsonlEntryBase & { kind: "invalid"; /** Parse error message. */ error: string })
  | (JsonlEntryBase & { kind: "too-large" })
  | (JsonlEntryBase & {
      kind: "value";
      /** Derived identity, e.g. the top-level `id`. */ label?: string;
    });

export interface JsonlEntriesPayload {
  requestId: number;
  start: number;
  entries: JsonlEntrySummary[];
}

/** One entry request; `index` is the zero-based line number. */
export interface JsonlEntryRequest {
  requestId: number;
  index: number;
}

/** Everything the detail pane needs for one entry: the summary plus its full text/value. */
interface JsonlDetailBase extends JsonlEntryBase {
  /** Full line text, capped at JSONL_MAX_TEXT_CHARS. */
  text: string;
  /** Character count of the whole line, before the cap. */
  textChars: number;
  /** True when `text` is shorter than the line; the raw view says so instead of pretending. */
  textTruncated: boolean;
}

export type JsonlEntryDetail =
  | (JsonlDetailBase & { kind: "empty" })
  | (JsonlDetailBase & { kind: "invalid"; error: string })
  | (JsonlDetailBase & { kind: "too-large" })
  | (JsonlDetailBase & {
      kind: "value";
      label?: string;
      /** Parsed JSON, under the size cap. */
      value: unknown;
    });

export interface JsonlEntryPayload {
  requestId: number;
  index: number;
  /** Null when the line no longer exists (empty file, truncated/reloaded). */
  entry: JsonlEntryDetail | null;
}

/* ---------- search ---------- */

/** Matches streamed to the directory pane per message. */
export const JSONL_SEARCH_BATCH = 200;

/** Hard stop for a single scan, so a broad query cannot exhaust memory. */
export const JSONL_SEARCH_MAX_MATCHES = 10_000;

export interface JsonlSearchRequest {
  requestId: number;
  query: string;
}

/**
 * Stop a scan the webview no longer wants. Without this the host keeps decoding until its
 * next cancellation check — the webview can only ignore output, not stop the work.
 */
export interface JsonlSearchCancel {
  requestId: number;
}

export interface JsonlSearchBatch {
  requestId: number;
  query: string;
  /** Matches found since the previous batch, not-yet-sent ones. */
  entries: JsonlEntrySummary[];
  scanned: number;
  total: number;
  matches: number;
  /** True on the final batch of a scan. */
  done: boolean;
  /** True when the scan stopped because JSONL_SEARCH_MAX_MATCHES was reached. */
  capped: boolean;
}
