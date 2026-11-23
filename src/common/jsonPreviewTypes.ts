/**
 * Wire format for the command-opened JSON preview.
 *
 * The host owns the text and the top-level array index; the webview receives record summaries,
 * one parsed record at a time, and search results. A JSON Preview is not a Viewer: there is no
 * custom-editor selector, no default takeover, and no editing path.
 */
import type { JsonlEntryDetail } from "./jsonlTypes";
import {
  MAX_TEXT_CHARS,
  RECORD_MAX_BYTES,
  SEARCH_BATCH,
  SEARCH_MAX_MATCHES,
  SUMMARY_CHARS,
} from "./recordConstants";

/** A top-level array larger than this is not indexed. */
export const JSON_MAX_ARRAY_BYTES = 100 * 1024 * 1024;
/** Object/scalar roots are parsed whole, so they have a smaller cap. */
export const JSON_MAX_OBJECT_BYTES = 20 * 1024 * 1024;
/** A single record above this is shown as raw text instead of a tree. */
export const JSON_RECORD_MAX_BYTES = RECORD_MAX_BYTES;
/** Characters of raw text shipped for a record/root. */
export const JSON_MAX_TEXT_CHARS = MAX_TEXT_CHARS;
/** Characters of raw text kept for a record label fallback / preview (one number, ADR-0030). */
export const JSON_RAW_PREVIEW_CHARS = SUMMARY_CHARS;
/** Records parsed per summary window request. */
export const JSON_RECORD_WINDOW = 100;
/** Records per search result message. */
export const JSON_SEARCH_BATCH = SEARCH_BATCH;
/** Hard stop so a one-character query cannot exhaust memory. */
export const JSON_SEARCH_MAX_MATCHES = SEARCH_MAX_MATCHES;
/** Characters read per search turn before yielding control. */
export const JSON_SEARCH_CHAR_BUDGET = 2_000_000;

export type JsonRootKind = "array" | "object" | "scalar" | "too-large" | "invalid";

export interface JsonRecordRangeLike {
  start: number;
  end: number;
}

/**
 * A cached range list must be ordered, non-overlapping, inside the text and fit the 32-bit
 * disk format. Shared by the session (which trusts it before skipping the scan) and the disk
 * cache (which writes it).
 */
export function isUsableRecordRanges(
  ranges: unknown,
  textLength: number,
): ranges is JsonRecordRangeLike[] {
  if (!Array.isArray(ranges)) return false;
  let previousEnd = -1;
  for (const value of ranges) {
    if (!value || typeof value !== "object") return false;
    const { start, end } = value as Partial<JsonRecordRangeLike>;
    if (
      typeof start !== "number" ||
      typeof end !== "number" ||
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < previousEnd ||
      end <= start ||
      end > textLength ||
      end > 0xffff_ffff
    ) {
      return false;
    }
    previousEnd = end;
  }
  return true;
}

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
  /** Ship the record's raw text too; the tree only needs the parsed value (ADR-0030). */
  withText?: boolean;
}

export interface JsonRecordPayload {
  requestId: number;
  index: number;
  entry: JsonlEntryDetail | null;
}

/** Ask for the raw text of a record that was fetched without it. */
export interface JsonRecordTextRequest {
  requestId: number;
  index: number;
}

export interface JsonRecordTextPayload {
  requestId: number;
  index: number;
  text: string;
  textChars: number;
  textTruncated: boolean;
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
