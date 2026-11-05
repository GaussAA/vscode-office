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

/** A line larger than this is not parsed; it is shown as raw text instead. */
export const JSONL_MAX_LINE_BYTES = 512 * 1024;

/** Entries are streamed into the directory pane in chunks of this size. */
export const JSONL_CHUNK_SIZE = 500;

/** Top-level keys tried, in order, when deriving a human-friendly label. */
export const JSONL_LABEL_KEYS = ['id', '_id', 'uuid', 'key', 'name', 'title', 'ts', 'timestamp'] as const;

/** How many characters of the raw line are kept for previews. */
export const JSONL_RAW_PREVIEW_CHARS = 400;

/** Upper bound for the full text shipped to the raw view. */
export const JSONL_MAX_TEXT_CHARS = 200_000;

export interface JsonlInfoPayload {
    fileName: string;
    /** Stable identity for state persistence (scheme + uri). */
    cacheId: string;
    lineCount: number;
    byteSize: number;
    readOnly: boolean;
}

export interface JsonlRangeRequest {
    start: number;
    end: number;
}

/** One directory row: cheap to produce, cheap to keep in memory. */
export interface JsonlEntrySummary {
    /** Zero-based line index. */
    index: number;
    /** Byte length of the line, excluding the newline. */
    size: number;
    /** Truncated raw text, for the directory preview. */
    raw: string;
    /** Derived identity, e.g. the value of the top-level `id` key. */
    label?: string;
    /** Search-only: a window of text around the match, instead of the line's head. */
    snippet?: string;
    empty?: boolean;
    /** Parse error message, when the line is not valid JSON. */
    error?: string;
    /** True when the line exceeded JSONL_MAX_LINE_BYTES and was not parsed. */
    tooLarge?: boolean;
}

export interface JsonlEntriesPayload {
    start: number;
    entries: JsonlEntrySummary[];
}

/** Everything the detail pane needs for one entry. */
export interface JsonlEntryDetail extends JsonlEntrySummary {
    /** Parsed JSON, when the line parsed and was under the size cap. */
    value?: unknown;
    /** Full line text (capped), for the raw view. */
    text?: string;
}

export interface JsonlEntryPayload {
    index: number;
    entry: JsonlEntryDetail;
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
