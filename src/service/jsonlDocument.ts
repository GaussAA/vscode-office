/**
 * Host-side JSONL reading: build a line index once, then hand out summaries
 * (for the directory pane) or one full entry (for the detail pane) on demand.
 * The file bytes never cross the postMessage boundary, which keeps large files
 * (hundreds of MB, millions of lines) out of the webview.
 */
import {
  JSONL_MAX_LINE_BYTES,
  JSONL_MAX_TEXT_CHARS,
  JSONL_RAW_PREVIEW_CHARS,
  type JsonlEntryDetail,
  type JsonlEntrySummary,
} from "@/common/jsonlTypes";
import { classifyEntry, truncate } from "@/service/entryClassifier";
import {
  findCaseInsensitive,
  foldNeedle,
  snippetAround,
} from "@/service/recordAddressableDocument";

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

/** Line size in bytes, excluding the terminator. Used to short-circuit decoding huge lines. */
function lineSizeBytes(bytes: Uint8Array, index: JsonlIndex, line: number): number {
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

/** Decode the bytes of one line (terminator included) to text. */
export function decodeJsonlLine(slice: Uint8Array): string {
  // A UTF-8 BOM at byte 0 would otherwise make the first line invalid JSON.
  return decoder
    .decode(slice)
    .replace(/^\uFEFF/, "")
    .replace(/[\r\n]+$/, "");
}

/** Decode one line to text. Exported so the searcher can scan without re-parsing. */
export function readJsonlLineText(bytes: Uint8Array, index: JsonlIndex, line: number): string {
  return decodeJsonlLine(lineBytes(bytes, index, line));
}

/**
 * Build a summary for a line whose text has already been decoded.
 *
 * `needle` turns the summary into a search hit and adds `hit`: the line is parsed anyway, so
 * saying whether the match was in a key or in a value costs nothing extra.
 */
export function summarizeDecodedLine(
  line: number,
  rawText: string,
  needle?: string,
): JsonlEntrySummary {
  const classification = classifyEntry(rawText);
  const base = {
    index: line,
    size: classification.byteSize,
    raw: truncate(classification.text, JSONL_RAW_PREVIEW_CHARS),
  };

  if (classification.kind === "empty") {
    return { ...base, kind: "empty" };
  }
  if (classification.kind === "too-large") {
    return { ...base, kind: "too-large" };
  }
  if (classification.kind === "invalid") {
    return { ...base, kind: "invalid", error: classification.error! };
  }

  // kind === "value"
  const summary: JsonlEntrySummary = {
    ...base,
    kind: "value",
    ...(classification.label ? { label: classification.label } : {}),
  };

  if (needle) {
    const hit = classifyHit(classification.value, needle);
    if (hit) summary.hit = hit;
  }

  return summary;
}

/**
 * Where does `needle` occur — in a key path component, in a leaf value, or both?
 *
 * Iterative and budgeted: a transcript line can nest deeply and hold thousands of nodes, and the
 * scan already reads the whole file, so this tiebreaker must not become the expensive part of a
 * search. `undefined` means the match was only in syntax (punctuation, number formatting), which
 * is honest: the row still matched the substring, it just has no key/value story.
 */
export function classifyHit(value: unknown, needle: string): "key" | "value" | "both" | undefined {
  if (!needle) return undefined;
  const stack: unknown[] = [value];
  let visited = 0;
  let inKey = false;
  let inValue = false;
  while (stack.length > 0 && visited < 20_000 && !(inKey && inValue)) {
    const node = stack.pop();
    visited++;
    if (Array.isArray(node)) {
      for (const item of node) stack.push(item);
      continue;
    }
    if (node !== null && typeof node === "object") {
      for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
        if (findCaseInsensitive(key, foldNeedle(needle))) inKey = true;
        stack.push(child);
      }
      continue;
    }
    if (typeof node === "string" || typeof node === "number" || typeof node === "boolean") {
      if (findCaseInsensitive(String(node), foldNeedle(needle))) inValue = true;
    }
  }
  if (inKey && inValue) return "both";
  if (inKey) return "key";
  if (inValue) return "value";
  return undefined;
}

/**
 * A window of text centred on the first match. Long JSONL lines hide their match
 * hundreds of characters in, so the directory row shows the snippet instead of the
 * line's head when a search is active.
 */
export function matchSnippet(text: string, needle: string, radius = 48): string | undefined {
  const match = findCaseInsensitive(text, foldNeedle(needle));
  if (!match) return undefined;
  // One summary number everywhere (ADR-0030), snippets included: the directory row is a
  // summary, and the panel is where the full value is read.
  return truncate(
    snippetAround(text, match.start, match.end, radius, radius),
    JSONL_RAW_PREVIEW_CHARS,
  );
}

/**
 * Directory payload: parse only far enough to derive the identity label.
 *
 * `baseLine` exists because a caller may hold only a window of the file: the window's local
 * index starts at 0, but the entries it produces must still carry absolute line numbers.
 *
 * Performance: checks byte size BEFORE decoding; a 100 MB line never becomes a 100 MB string.
 */
export function buildJsonlSummary(
  bytes: Uint8Array,
  index: JsonlIndex,
  line: number,
  baseLine = 0,
): JsonlEntrySummary {
  const size = lineSizeBytes(bytes, index, line);

  // Short-circuit: don't decode huge lines just to classify them as too-large
  if (size > JSONL_MAX_LINE_BYTES) {
    return {
      index: baseLine + line,
      size,
      raw: truncate(readLineHead(bytes, index, line), JSONL_RAW_PREVIEW_CHARS),
      kind: "too-large",
    };
  }

  const rawText = readJsonlLineText(bytes, index, line);
  const classification = classifyEntry(rawText);

  const base = {
    index: baseLine + line,
    size: classification.byteSize,
    raw: truncate(classification.text, JSONL_RAW_PREVIEW_CHARS),
  };

  if (classification.kind === "empty") {
    return { ...base, kind: "empty" };
  }
  if (classification.kind === "too-large") {
    return { ...base, kind: "too-large" };
  }
  if (classification.kind === "invalid") {
    return { ...base, kind: "invalid", error: classification.error! };
  }

  return {
    ...base,
    kind: "value",
    ...(classification.label ? { label: classification.label } : {}),
  };
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
  const rawText = readJsonlLineText(bytes, index, line);
  const classification = classifyEntry(rawText);
  const at = baseLine + line;

  // A plain prefix, not a "…"-suffixed string: the flag is the truth, and the notice can
  // say how many characters are missing. The old truncate() made 200,000 characters look
  // like a complete value.
  const textChars = classification.text.length;
  const textTruncated = textChars > JSONL_MAX_TEXT_CHARS;
  const fullText = textTruncated
    ? classification.text.slice(0, JSONL_MAX_TEXT_CHARS)
    : classification.text;
  // The tree needs the parsed value, not the line: shipping both doubles every detail message
  // (ADR-0030). Raw shows the same 120-character summary as every other surface (`raw` below),
  // so a value line never carries its text. Error lines are the exception — their raw text is
  // the content the panel reads.
  const text = classification.kind === "value" ? "" : fullText;

  const base = {
    index: at,
    size: classification.byteSize,
    raw: truncate(classification.text, JSONL_RAW_PREVIEW_CHARS),
    text,
    textChars,
    textTruncated,
  };

  if (classification.kind === "empty") {
    return { ...base, kind: "empty" };
  }
  if (classification.kind === "too-large") {
    return { ...base, kind: "too-large" };
  }
  if (classification.kind === "invalid") {
    return { ...base, kind: "invalid", error: classification.error! };
  }

  return {
    ...base,
    kind: "value",
    ...(classification.label ? { label: classification.label } : {}),
    value: classification.value!,
  };
}
