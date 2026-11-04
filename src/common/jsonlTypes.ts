/**
 * Wire format shared by the extension host and the JSONL webview.
 *
 * The host owns the bytes and the line index; the webview only ever receives
 * parsed line payloads. Nothing here may import `vscode` — the webview bundle
 * imports it too.
 */

/** A line larger than this is not parsed; it is shown as raw text instead. */
export const JSONL_MAX_LINE_BYTES = 512 * 1024;

/** Lines are loaded in windows of this size. */
export const JSONL_WINDOW_SIZE = 200;

export interface JsonlInfoPayload {
    fileName: string;
    lineCount: number;
    byteSize: number;
    readOnly: boolean;
}

export interface JsonlReadRequest {
    start: number;
    end: number;
}

export interface JsonlLinePayload {
    /** Zero-based line index. */
    index: number;
    /** Byte length of the line, excluding the newline. */
    size: number;
    /** Preview / raw text, truncated to a display-friendly length. */
    raw: string;
    /** Parsed JSON, present only when the line parsed and was under the size cap. */
    value?: unknown;
    /** Parse error message, when the line is not valid JSON. */
    error?: string;
    /** True when the line exceeded JSONL_MAX_LINE_BYTES and was not parsed. */
    tooLarge?: boolean;
    /** True for whitespace-only lines. */
    empty?: boolean;
}

export interface JsonlLinesPayload {
    start: number;
    lines: JsonlLinePayload[];
}
