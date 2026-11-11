/**
 * Wire format for the command-opened JSON preview.
 *
 * The host owns the text and the top-level array index; the webview receives record summaries,
 * one parsed record at a time, and search results. A JSON Preview is not a Viewer: there is no
 * custom-editor selector, no default takeover, and no editing path.
 */
import type { JsonlEntryDetail } from "./jsonlTypes";

/** A top-level array larger than this is not indexed. */
export const JSON_MAX_ARRAY_BYTES = 100 * 1024 * 1024;
/** Object/scalar roots are parsed whole, so they have a smaller cap. */
export const JSON_MAX_OBJECT_BYTES = 20 * 1024 * 1024;
/** A single record above this is shown as raw text instead of a tree. */
export const JSON_RECORD_MAX_BYTES = 8 * 1024 * 1024;
/** Characters of raw text shipped for a record/root. */
export const JSON_MAX_TEXT_CHARS = 1_000_000;
/** Characters of raw text kept for a record label fallback / preview. */
export const JSON_RAW_PREVIEW_CHARS = 400;
/** Records parsed per summary window request. */
export const JSON_RECORD_WINDOW = 100;
/** Records per search result message. */
export const JSON_SEARCH_BATCH = 200;
/** Hard stop so a one-character query cannot exhaust memory. */
export const JSON_SEARCH_MAX_MATCHES = 10_000;

export type JsonRootKind = "array" | "object" | "scalar" | "too-large" | "invalid";

export interface JsonSyntaxErrorInfo {
  message: string;
  /** 1-based. */
  line: number;
  /** 1-based. */
  column: number;
}

export interface JsonInfoPayload {
  fileName: string;
  /** Stable identity for local persistence (scheme + uri). */
  cacheId: string;
  byteSize: number;
  rootKind: JsonRootKind;
  /** Top-level array length; 0 for non-array roots. */
  recordCount: number;
  /** True when the preview is reading an unsaved editor buffer. */
  fromBuffer: boolean;
  /** Present for rootKind === "invalid". */
  error?: JsonSyntaxErrorInfo;
}

export interface JsonRecordSummary {
  index: number;
  kind: "value" | "too-large" | "invalid";
  /** UTF-8 byte length of the record's raw text. */
  size: number;
  /** Trimmed raw text, capped at JSON_RAW_PREVIEW_CHARS. */
  raw: string;
  label?: string;
  /** Parse error for kind === "invalid". */
  error?: string;
}

export interface JsonRecordsRequest {
  requestId: number;
  start: number;
  end: number;
}

export interface JsonRecordsPayload {
  requestId: number;
  records: JsonRecordSummary[];
}

export interface JsonRecordRequest {
  requestId: number;
  index: number;
}

export interface JsonRecordPayload {
  requestId: number;
  index: number;
  entry: JsonlEntryDetail | null;
}

/** A whole-document parse for object/scalar roots (and a root too-large/error entry). */
export interface JsonRootPayload {
  entry: JsonlEntryDetail | null;
}

export interface JsonSearchRequest {
  requestId: number;
  query: string;
}

export interface JsonSearchCancel {
  requestId: number;
}

export interface JsonSearchRecord {
  index: number;
  /** Occurrences inside this record; the result row says `N matches`. */
  count: number;
  /** A window around the first match, one line. */
  snippet: string;
}

export interface JsonSearchBatch {
  requestId: number;
  query: string;
  records: JsonSearchRecord[];
  /** Characters scanned so far (the host may scan in batches). */
  scanned: number;
  /** Total characters in the document. */
  total: number;
  /** Total occurrences found so far. */
  matches: number;
  done: boolean;
  /** True when JSON_SEARCH_MAX_MATCHES stopped the scan. */
  capped: boolean;
}
