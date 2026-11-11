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

/** Line size in bytes, excluding the terminator (the same rule `readJsonlLineText` uses). */
function lineSize(bytes: Uint8Array, index: JsonlIndex, line: number): number {
  const slice = lineBytes(bytes, index, line);
  if (slice.length === 0) return 0;
  return slice.length - (slice[slice.length - 1] === 0x0a ? 1 : 0);
}

/** Enough for a 400-character preview even when every character is four UTF-8 bytes. */
const HEAD_DECODE_BYTES = 4 * 1024;

/**
 * Decode just the beginning of a line. This is what the directory uses for a line above the
 * parse cap: decoding a 100 MB record only to slice 400 characters out of it allocated a
 * 100 MB string per row and made the list allocate in proportion to the file. A cut through
 * a multi-byte sequence leaves U+FFFD at the end; drop that one replacement character.
 */
function readLineHead(bytes: Uint8Array, index: JsonlIndex, line: number): string {
  const slice = lineBytes(bytes, index, line);
  if (slice.length === 0) return "";
  const head = slice.subarray(0, Math.min(slice.length, HEAD_DECODE_BYTES));
  let text = decoder.decode(head);
  if (head.length < slice.length && text.endsWith("\uFFFD")) text = text.slice(0, -1);
  return text.replace(/^\uFEFF/, "").replace(/[\r\n]+$/, "");
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Derive a human-friendly label from the entry's TOP-LEVEL identity keys.
 *
 * A top-level identity key whose value is an object is still this entry's identity container
 * (agent transcripts commonly store `id: { query, ... }`). Look one level inside it, but never
 * descend into arbitrary nested objects: a child record's `id` is not this entry's identity.
 * Without this, every record of that shape falls back to its raw JSON head and the directory
 * becomes a wall of identical rows.
 */
const NESTED_LABEL_KEYS = ["query", "name", "title", "label", "id", "key"] as const;

function scalarLabel(candidate: unknown): string | undefined {
  if (typeof candidate === "string") {
    const trimmed = candidate.trim();
    return trimmed ? truncate(trimmed, 40) : undefined;
  }
  if (
    typeof candidate === "number" ||
    typeof candidate === "bigint" ||
    typeof candidate === "boolean"
  ) {
    return String(candidate);
  }
  return undefined;
}

export function deriveLabel(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  for (const key of JSONL_LABEL_KEYS) {
    if (!(key in value)) continue;
    const candidate = value[key];
    const direct = scalarLabel(candidate);
    if (direct) return direct;
    if (Array.isArray(candidate)) {
      // `query_search: ["..."]` stores the text in a one-element array. Reading the first
      // scalar is enough for a row label; an array of objects yields nothing and falls through.
      for (const item of candidate.slice(0, 3)) {
        const label = scalarLabel(item);
        if (label) return label;
      }
      continue;
    }
    if (isRecord(candidate)) {
      for (const nestedKey of NESTED_LABEL_KEYS) {
        const nested = scalarLabel(candidate[nestedKey]);
        if (nested) return nested;
      }
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
  const size = lineSize(bytes, index, line);
  if (size > JSONL_MAX_LINE_BYTES) {
    // Do not decode a megabyte-scale line to show its size and 400-character head.
    return {
      index: baseLine + line,
      size,
      raw: truncate(readLineHead(bytes, index, line), JSONL_RAW_PREVIEW_CHARS),
      kind: "too-large",
    };
  }
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
  // A plain prefix, not a "…"-suffixed string: the flag is the truth, and the notice can
  // say how many characters are missing. The old truncate() made 200,000 characters look
  // like a complete value.
  const textChars = decoded.text.length;
  const textTruncated = textChars > JSONL_MAX_TEXT_CHARS;
  const text = textTruncated ? decoded.text.slice(0, JSONL_MAX_TEXT_CHARS) : decoded.text;
  const base = { index: at, size, raw, text, textChars, textTruncated };

  if (decoded.text.trim() === "") {
    return { ...base, kind: "empty" };
  }
  if (size > JSONL_MAX_LINE_BYTES) {
    return { ...base, kind: "too-large" };
  }
  try {
    const value = JSON.parse(decoded.text);
    return { ...base, kind: "value", label: deriveLabel(value), value };
  } catch (error) {
    return {
      ...base,
      kind: "invalid",
      error: error instanceof Error ? error.message : "Invalid JSON",
    };
  }
}
