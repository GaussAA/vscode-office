/**
 * Host-side JSONL reading: build a line index once, then hand out summaries
 * (for the directory pane) or one full entry (for the detail pane) on demand.
 * The file bytes never cross the postMessage boundary, which keeps large files
 * (hundreds of MB, millions of lines) out of the webview.
 */
import {
  JSONL_LABEL_KEYS,
  JSONL_MAX_LINE_BYTES,
  JSONL_MAX_TEXT_CHARS,
  JSONL_RAW_PREVIEW_CHARS,
  type JsonlEntryDetail,
  type JsonlEntrySummary,
} from "@/common/jsonlTypes";

export interface JsonlIndex {
  lineCount: number;
  /** offsets[i] = byte offset where line i starts. */
  offsets: number[];
}

const decoder = new TextDecoder("utf-8");

export function buildJsonlIndex(bytes: Uint8Array): JsonlIndex {
  const offsets: number[] = [0];
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0x0a) {
      offsets.push(i + 1);
    }
  }
  // A trailing newline is a terminator, not an empty final line.
  if (offsets.length > 1 && offsets[offsets.length - 1] >= bytes.length) {
    offsets.pop();
  }
  return { offsets, lineCount: offsets.length };
}

function lineBytes(bytes: Uint8Array, index: JsonlIndex, line: number): Uint8Array {
  const start = index.offsets[line];
  const end = line + 1 < index.lineCount ? index.offsets[line + 1] : bytes.length;
  return bytes.subarray(start, end);
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Derive a human-friendly label from the entry's TOP-LEVEL keys only.
 * Nested `id`s belong to child records, so they are deliberately ignored.
 */
export function deriveLabel(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  for (const key of JSONL_LABEL_KEYS) {
    if (!(key in value)) continue;
    const candidate = value[key];
    if (typeof candidate === "string") {
      const trimmed = candidate.trim();
      if (trimmed) return truncate(trimmed, 40);
      continue;
    }
    if (
      typeof candidate === "number" ||
      typeof candidate === "bigint" ||
      typeof candidate === "boolean"
    ) {
      return String(candidate);
    }
  }
  return undefined;
}

interface DecodedLine {
  text: string;
  size: number;
}

/** Decode one line to text. Exported so the searcher can scan without re-parsing. */
export function readJsonlLineText(bytes: Uint8Array, index: JsonlIndex, line: number): DecodedLine {
  const slice = lineBytes(bytes, index, line);
  // A UTF-8 BOM at byte 0 would otherwise make the first line invalid JSON.
  const text = decoder
    .decode(slice)
    .replace(/^\uFEFF/, "")
    .replace(/[\r\n]+$/, "");
  // size excludes the line terminator
  const size = Math.max(
    0,
    text.length === 0 ? 0 : slice.length - (slice[slice.length - 1] === 0x0a ? 1 : 0),
  );
  return { text, size };
}

/** Build a summary for a line whose text has already been decoded. */
export function summarizeDecodedLine(line: number, decoded: DecodedLine): JsonlEntrySummary {
  return classify(line, decoded);
}

/**
 * A window of text centred on the first match. Long JSONL lines hide their match
 * hundreds of characters in, so the directory row shows the snippet instead of the
 * line's head when a search is active.
 */
export function matchSnippet(text: string, needle: string, radius = 48): string | undefined {
  const at = text.toLowerCase().indexOf(needle);
  if (at < 0) return undefined;
  const start = Math.max(0, at - radius);
  const end = Math.min(text.length, at + needle.length + radius);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

/** One line of JSONL is exactly one of four things; this is where that is decided. */
function classify(line: number, decoded: DecodedLine): JsonlEntrySummary {
  const { text, size } = decoded;
  const raw = truncate(text, JSONL_RAW_PREVIEW_CHARS);
  if (text.trim() === "") {
    return { index: line, size, raw: "", kind: "empty" };
  }
  if (size > JSONL_MAX_LINE_BYTES) {
    return { index: line, size, raw, kind: "too-large" };
  }
  try {
    const value = JSON.parse(text);
    return { index: line, size, raw, kind: "value", label: deriveLabel(value) };
  } catch (error) {
    return {
      index: line,
      size,
      raw,
      kind: "invalid",
      error: error instanceof Error ? error.message : "Invalid JSON",
    };
  }
}

/**
 * Directory payload: parse only far enough to derive the identity label.
 *
 * `baseLine` exists because a caller may hold only a window of the file: the window's local
 * index starts at 0, but the entries it produces must still carry absolute line numbers.
 */
export function buildJsonlSummary(
  bytes: Uint8Array,
  index: JsonlIndex,
  line: number,
  baseLine = 0,
): JsonlEntrySummary {
  return classify(baseLine + line, readJsonlLineText(bytes, index, line));
}

export function buildJsonlSummaries(
  bytes: Uint8Array,
  index: JsonlIndex,
  start: number,
  end: number,
  baseLine = 0,
): JsonlEntrySummary[] {
  const from = Math.max(0, Math.min(start, index.lineCount));
  const to = Math.max(from, Math.min(end, index.lineCount));
  const entries: JsonlEntrySummary[] = [];
  for (let i = from; i < to; i++) {
    entries.push(buildJsonlSummary(bytes, index, i, baseLine));
  }
  return entries;
}

/** Detail payload: the whole parsed entry, for one line only. */
export function buildJsonlEntry(
  bytes: Uint8Array,
  index: JsonlIndex,
  line: number,
  baseLine = 0,
): JsonlEntryDetail {
  const decoded = readJsonlLineText(bytes, index, line);
  const at = baseLine + line;
  const { size } = decoded;
  const raw = truncate(decoded.text, JSONL_RAW_PREVIEW_CHARS);
  const text = truncate(decoded.text, JSONL_MAX_TEXT_CHARS);

  if (decoded.text.trim() === "") {
    return { index: at, size, raw: "", kind: "empty", text };
  }
  if (size > JSONL_MAX_LINE_BYTES) {
    return { index: at, size, raw, kind: "too-large", text };
  }
  try {
    const value = JSON.parse(decoded.text);
    return { index: at, size, raw, kind: "value", label: deriveLabel(value), value, text };
  } catch (error) {
    return {
      index: at,
      size,
      raw,
      kind: "invalid",
      error: error instanceof Error ? error.message : "Invalid JSON",
      text,
    };
  }
}
