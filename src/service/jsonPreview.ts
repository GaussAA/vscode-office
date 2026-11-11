/**
 * Host-side JSON document parsing for the command-opened preview.
 *
 * The top-level array is the unit that can be huge: at 100 MB we only scan record boundaries
 * and parse a record when the webview asks for it. Object/scalar roots are capped at 20 MB and
 * parsed whole. Nothing here imports `vscode`; the panel translates messages to these calls.
 */
import type { JsonlEntryDetail } from "@/common/jsonlTypes";
import {
  JSON_MAX_ARRAY_BYTES,
  JSON_MAX_OBJECT_BYTES,
  JSON_MAX_TEXT_CHARS,
  JSON_RAW_PREVIEW_CHARS,
  JSON_RECORD_MAX_BYTES,
  JSON_RECORD_WINDOW,
  JSON_SEARCH_BATCH,
  JSON_SEARCH_MAX_MATCHES,
  type JsonInfoPayload,
  type JsonRecordSummary,
  type JsonRootKind,
  type JsonSearchBatch,
  type JsonSearchRecord,
  type JsonSyntaxErrorInfo,
} from "@/common/jsonPreviewTypes";
import { deriveLabel, matchSnippet } from "@/service/jsonlDocument";

export interface JsonRecordRange {
  start: number;
  /** Exclusive, in UTF-16 code units of the original text. */
  end: number;
}

/** Internal scanner error, converted to a line/column before crossing the wire. */
export class JsonScanError extends Error {
  constructor(
    message: string,
    readonly offset: number,
  ) {
    super(message);
    this.name = "JsonScanError";
  }
}

export function lineColumnAt(text: string, offset: number): { line: number; column: number } {
  const limit = Math.max(0, Math.min(offset, text.length));
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < limit; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, column: limit - lineStart + 1 };
}

function errorInfo(text: string, error: unknown): JsonSyntaxErrorInfo {
  const offset =
    error instanceof JsonScanError
      ? error.offset
      : (() => {
          const match = /position (\d+)/.exec(error instanceof Error ? error.message : "");
          return match ? Number.parseInt(match[1], 10) : 0;
        })();
  const { line, column } = lineColumnAt(text, offset);
  return {
    message: error instanceof Error ? error.message : String(error),
    line,
    column,
  };
}

function isWhitespace(char: string): boolean {
  return (
    char === " " ||
    char === "\t" ||
    char === "\n" ||
    char === "\r" ||
    char === "\uFEFF" ||
    char === "\v" ||
    char === "\f"
  );
}

function skipWhitespace(text: string, from: number): number {
  let i = from;
  while (i < text.length && isWhitespace(text[i])) i++;
  return i;
}

function scanString(text: string, start: number): number {
  let i = start + 1;
  while (i < text.length) {
    const char = text[i];
    if (char === '"') return i + 1;
    if (char === "\\") {
      i += 2;
      continue;
    }
    if (char.charCodeAt(0) < 0x20) {
      throw new JsonScanError("Unescaped control character in string", i);
    }
    i++;
  }
  throw new JsonScanError("Unterminated string", start);
}

/** Scan a balanced `{...}` or `[...]`; inner syntax is validated by JSON.parse on demand. */
function scanComposite(text: string, start: number): number {
  const stack: string[] = [];
  let i = start;
  while (i < text.length) {
    const char = text[i];
    if (char === '"') {
      i = scanString(text, i);
      continue;
    }
    if (char === "{") {
      stack.push("}");
      i++;
      continue;
    }
    if (char === "[") {
      stack.push("]");
      i++;
      continue;
    }
    if (char === "}" || char === "]") {
      if (stack.pop() !== char) throw new JsonScanError(`Unexpected ${char}`, i);
      i++;
      if (stack.length === 0) return i;
      continue;
    }
    i++;
  }
  throw new JsonScanError("Unterminated object or array", start);
}

function scanRecord(text: string, start: number): number {
  const char = text[start];
  if (char === '"') return scanString(text, start);
  if (char === "{" || char === "[") return scanComposite(text, start);
  if (char === "," || char === "]" || char === "}") {
    throw new JsonScanError(`Unexpected ${char}`, start);
  }
  let i = start;
  while (i < text.length) {
    const current = text[i];
    if (current === "," || current === "]" || current === "}" || isWhitespace(current)) break;
    i++;
  }
  if (i === start) throw new JsonScanError("Expected a JSON value", start);
  return i;
}

/** Index a top-level JSON array without parsing the records. Throws JsonScanError. */
export function indexJsonArray(text: string, start = 0): JsonRecordRange[] {
  let i = skipWhitespace(text, start);
  if (text[i] !== "[") throw new JsonScanError("Expected a top-level JSON array", i);
  i++;
  const records: JsonRecordRange[] = [];
  i = skipWhitespace(text, i);
  if (text[i] === "]") {
    i = skipWhitespace(text, i + 1);
    if (i < text.length) throw new JsonScanError("Unexpected trailing text", i);
    return records;
  }
  for (;;) {
    i = skipWhitespace(text, i);
    if (i >= text.length) throw new JsonScanError("Unterminated array", i);
    if (text[i] === ",") throw new JsonScanError("Missing value before comma", i);
    const recordStart = i;
    const recordEnd = scanRecord(text, i);
    records.push({ start: recordStart, end: recordEnd });
    i = skipWhitespace(text, recordEnd);
    if (i >= text.length) throw new JsonScanError("Unterminated array", i);
    if (text[i] === "]") {
      i = skipWhitespace(text, i + 1);
      if (i < text.length) throw new JsonScanError("Unexpected trailing text", i);
      return records;
    }
    if (text[i] !== ",") throw new JsonScanError("Expected a comma between records", i);
    i = skipWhitespace(text, i + 1);
    if (text[i] === "]") throw new JsonScanError("Trailing comma is not valid JSON", i);
  }
}

function utf8Size(text: string): number {
  return new TextEncoder().encode(text).length;
}

function previewText(text: string): string {
  return text.length <= JSON_RAW_PREVIEW_CHARS ? text : `${text.slice(0, JSON_RAW_PREVIEW_CHARS)}…`;
}

function textFields(raw: string): {
  text: string;
  textChars: number;
  textTruncated: boolean;
  size: number;
} {
  return {
    text: raw.slice(0, JSON_MAX_TEXT_CHARS),
    textChars: raw.length,
    textTruncated: raw.length > JSON_MAX_TEXT_CHARS,
    size: utf8Size(raw),
  };
}

/** Parse one nested record (or the object root) into the detail shape the JSONL tree uses. */
export function readJsonRecordDetail(
  text: string,
  range: { start: number; end: number },
  index: number,
): JsonlEntryDetail {
  const raw = text.slice(range.start, range.end);
  const fields = textFields(raw);
  const base = {
    index,
    size: fields.size,
    raw: previewText(raw),
    text: fields.text,
    textChars: fields.textChars,
    textTruncated: fields.textTruncated,
  };
  if (fields.size > JSON_RECORD_MAX_BYTES) {
    return { ...base, kind: "too-large", textTruncated: true };
  }
  try {
    return { ...base, kind: "value", value: JSON.parse(raw) };
  } catch (error) {
    return {
      ...base,
      kind: "invalid",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function readJsonRecordSummary(
  text: string,
  range: { start: number; end: number },
  index: number,
): JsonRecordSummary {
  const raw = text.slice(range.start, range.end);
  const size = utf8Size(raw);
  const summary = {
    index,
    size,
    raw: previewText(raw),
  };
  if (size > JSON_RECORD_MAX_BYTES) {
    return { ...summary, kind: "too-large" };
  }
  try {
    const value = JSON.parse(raw) as unknown;
    return { ...summary, kind: "value", label: deriveLabel(value) };
  } catch (error) {
    return {
      ...summary,
      kind: "invalid",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function findRecordIndex(records: JsonRecordRange[], offset: number): number {
  let low = 0;
  let high = records.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (records[mid].start <= offset) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  if (found < 0 || offset >= records[found].end) return -1;
  return found;
}

export interface JsonSearchOptions {
  batchSize?: number;
  maxMatches?: number;
  onBatch: (batch: JsonSearchBatch) => void;
  /** Checked between batches; a newer search stops this one. */
  shouldStop?: () => boolean;
}

function emitSearch(
  text: string,
  records: JsonRecordRange[],
  requestId: number,
  query: string,
  options: JsonSearchOptions,
): void {
  const batchSize = options.batchSize ?? JSON_SEARCH_BATCH;
  const maxMatches = options.maxMatches ?? JSON_SEARCH_MAX_MATCHES;
  const needle = query.trim().toLowerCase();
  const complete = (results: JsonSearchRecord[], matches: number) => {
    const batches: JsonSearchRecord[][] = [];
    for (let i = 0; i < results.length; i += batchSize) {
      batches.push(results.slice(i, i + batchSize));
    }
    if (batches.length === 0) batches.push([]);
    batches.forEach((batch, position) => {
      if (options.shouldStop?.()) return;
      options.onBatch({
        requestId,
        query,
        records: batch,
        scanned: text.length,
        total: text.length,
        matches,
        done: position === batches.length - 1,
        capped: maxMatches > 0 && matches >= maxMatches,
      });
    });
  };

  if (!needle) {
    options.onBatch({
      requestId,
      query,
      records: [],
      scanned: 0,
      total: text.length,
      matches: 0,
      done: true,
      capped: false,
    });
    return;
  }

  const haystack = text.toLowerCase();
  const first = new Map<number, { count: number; snippet: string }>();
  let matches = 0;
  let cursor = 0;
  while (cursor < haystack.length && matches < maxMatches) {
    const at = haystack.indexOf(needle, cursor);
    if (at < 0) break;
    const index = findRecordIndex(records, at);
    if (index >= 0) {
      const record = records[index];
      const existing = first.get(index);
      if (existing) existing.count++;
      else {
        const raw = text.slice(record.start, record.end);
        first.set(index, {
          count: 1,
          snippet: matchSnippet(raw, needle) ?? previewText(raw),
        });
      }
      matches++;
    }
    cursor = at + Math.max(1, needle.length);
  }

  const results = [...first.entries()].map(([index, entry]) => ({
    index,
    count: entry.count,
    snippet: entry.snippet,
  }));
  complete(results, matches);
}

export class JsonPreviewSession {
  readonly info: JsonInfoPayload;
  readonly rootEntry: JsonlEntryDetail | null = null;
  private readonly records: JsonRecordRange[] | null = null;
  private activeSearch: symbol | null = null;

  constructor(
    readonly text: string,
    byteSize: number,
    fileName: string,
    cacheId: string,
    fromBuffer: boolean,
  ) {
    let rootKind: JsonRootKind = "invalid";
    let recordCount = 0;
    let error: JsonSyntaxErrorInfo | undefined;
    const first = skipWhitespace(text, 0);
    if (byteSize > JSON_MAX_ARRAY_BYTES) {
      rootKind = "too-large";
    } else if (first >= text.length) {
      rootKind = "invalid";
      error = { message: "Empty JSON document", line: 1, column: 1 };
    } else if (text[first] === "[") {
      try {
        this.records = indexJsonArray(text, first);
        rootKind = "array";
        recordCount = this.records.length;
      } catch (caught) {
        rootKind = "invalid";
        error = errorInfo(text, caught);
      }
    } else if (text[first] === "{") {
      if (byteSize > JSON_MAX_OBJECT_BYTES) {
        rootKind = "too-large";
      } else {
        try {
          const raw = text.slice(first);
          const fields = textFields(raw);
          this.rootEntry = {
            index: 0,
            size: fields.size,
            raw: previewText(raw),
            text: fields.text,
            textChars: fields.textChars,
            textTruncated: fields.textTruncated,
            kind: "value",
            value: JSON.parse(raw),
          };
          rootKind = "object";
        } catch (caught) {
          rootKind = "invalid";
          error = errorInfo(text, caught);
        }
      }
    } else {
      if (byteSize > JSON_MAX_OBJECT_BYTES) {
        rootKind = "too-large";
      } else {
        try {
          const raw = text.slice(first);
          const fields = textFields(raw);
          this.rootEntry = {
            index: 0,
            size: fields.size,
            raw: previewText(raw),
            text: fields.text,
            textChars: fields.textChars,
            textTruncated: fields.textTruncated,
            kind: "value",
            value: JSON.parse(raw),
          };
          rootKind = "scalar";
        } catch (caught) {
          rootKind = "invalid";
          error = errorInfo(text, caught);
        }
      }
    }

    this.info = {
      fileName,
      cacheId,
      byteSize,
      rootKind,
      recordCount,
      fromBuffer,
      ...(error ? { error } : {}),
    };
  }

  recordsInWindow(start: number, end: number): JsonRecordSummary[] {
    if (!this.records) return [];
    const from = Math.max(0, Math.min(Math.trunc(start), this.records.length));
    const to = Math.max(
      from,
      Math.min(Math.trunc(end), from + JSON_RECORD_WINDOW, this.records.length),
    );
    const summaries: JsonRecordSummary[] = [];
    for (let index = from; index < to; index++) {
      summaries.push(readJsonRecordSummary(this.text, this.records[index], index));
    }
    return summaries;
  }

  record(index: number): JsonlEntryDetail | null {
    if (!this.records || !Number.isInteger(index) || index < 0 || index >= this.records.length) {
      return null;
    }
    return readJsonRecordDetail(this.text, this.records[index], index);
  }

  search(requestId: number, query: string, options: Omit<JsonSearchOptions, "shouldStop">): void {
    this.cancelSearch();
    const token = Symbol("json-search");
    this.activeSearch = token;
    const shouldStop = () => this.activeSearch !== token;
    const onBatch = (batch: JsonSearchBatch) => {
      if (this.activeSearch !== token) return;
      options.onBatch(batch);
      if (batch.done) this.activeSearch = null;
    };
    const schedule = (run: () => void) => setTimeout(run, 0);
    schedule(() => {
      if (shouldStop()) return;
      emitSearch(this.text, this.records ?? [], requestId, query, {
        ...options,
        onBatch,
        shouldStop,
      });
    });
  }

  cancelSearch(): void {
    this.activeSearch = null;
  }

  dispose(): void {
    this.cancelSearch();
  }
}

/** Error info for an empty/malformed root, used by tests and the panel. */
export function jsonSyntaxError(text: string, error: unknown): JsonSyntaxErrorInfo {
  return errorInfo(text, error);
}
