/**
 * Windowed row access for spreadsheets (phase 1 of ADR-0017).
 *
 * The full-table path builds one object per cell and hands the whole grid to the editor. That
 * costs ~9x the file in memory (measured: 152 MB CSV → 1.36 GB) and is why a size guard exists.
 * A `SheetSource` answers one question instead — "give me rows [start, end)" — so a viewer can
 * render only the viewport.
 *
 * This file implements the text half (CSV/TSV). Workbooks are phase 4: a zip's deflate stream
 * cannot be seeked, so they are parsed whole into a compact column store rather than streamed.
 */
import { parseCsv, parseCsvRecords } from "./csvParser";
import { decodeCsvBufferWithEncoding, type CsvEncoding } from "./csvEncoding";

export interface SheetSource {
  readonly kind: "text" | "workbook";
  readonly rowCount: number;
  readonly columnCount: number;
  /** Display text for rows `[start, end)`; callers ask for the viewport only. */
  readRows(start: number, end: number): Promise<string[][]>;
}

export interface TextSheetSource extends SheetSource {
  readonly kind: "text";
  readonly delimiter: string;
  readonly encoding: CsvEncoding;
}

const QUOTE = 0x22;
const LF = 0x0a;
const CR = 0x0d;

/** Enough to sample the delimiter and the encoding without decoding the whole file. */
const DETECT_BYTES = 256 * 1024;

/**
 * Byte offset of every record start.
 *
 * Newlines inside a quoted field are not record ends — that is the whole reason this is a
 * state machine instead of `indexOf("\n")`. Quote handling mirrors the parser: a quote only
 * opens a field at its start, and `""` inside a quoted field is an escaped quote.
 */
export function indexRecordStarts(bytes: Uint8Array, delimiter: number): number[] {
  const starts: number[] = [0];
  let inQuotes = false;
  let atFieldStart = true;
  for (let index = 0; index < bytes.length; index++) {
    const byte = bytes[index];
    if (inQuotes) {
      if (byte === QUOTE) {
        if (bytes[index + 1] === QUOTE) {
          index++;
        } else {
          inQuotes = false;
          atFieldStart = false;
        }
      }
      continue;
    }
    if (byte === QUOTE && atFieldStart) {
      inQuotes = true;
      atFieldStart = false;
      continue;
    }
    if (byte === delimiter) {
      atFieldStart = true;
      continue;
    }
    if (byte === LF) {
      starts.push(index + 1);
      atFieldStart = true;
      continue;
    }
    if (byte !== CR) atFieldStart = false;
  }
  // A trailing newline closes the last record; it does not start an empty one.
  if (starts.length > 1 && starts[starts.length - 1] >= bytes.length) starts.pop();
  if (starts.length === 1 && starts[0] >= bytes.length) return [];
  return starts;
}

/**
 * Open a CSV/TSV byte buffer as a windowed source.
 *
 * Keeps the bytes and one offset per record (8 bytes per row: 1M rows ≈ 8 MB) instead of a
 * cell object per value. Encoding and delimiter are decided once, from a prefix.
 */
export function createTextSheetSource(buffer: ArrayBuffer): TextSheetSource {
  const bytes = new Uint8Array(buffer);
  // A view shares the file's buffer; `slice()` copies just the bytes being decoded.
  const prefix = bytes.subarray(0, Math.min(bytes.length, DETECT_BYTES));
  const detected = decodeCsvBufferWithEncoding(prefix.slice().buffer as ArrayBuffer);
  let delimiter = ",";
  try {
    // The prefix may cut a quoted field in half; a throw just means "keep the default".
    delimiter = parseCsv(detected.text).delimiter;
  } catch {
    delimiter = ",";
  }
  const starts = indexRecordStarts(bytes, delimiter.charCodeAt(0));

  const decode = (slice: Uint8Array): string =>
    decodeCsvBufferWithEncoding(slice.slice().buffer as ArrayBuffer).text;

  // Sampled once: the grid needs a column count before the first window is read. A later
  // window with more columns still renders — the count is a header hint, not a bound.
  let columnCount = 1;
  if (starts.length > 0) {
    const sampleEnd = Math.min(starts.length, 200);
    const sample = decode(
      bytes.subarray(starts[0], sampleEnd < starts.length ? starts[sampleEnd] : bytes.length),
    );
    for (const row of parseCsvRecords(sample, delimiter)) {
      if (row.length > columnCount) columnCount = row.length;
    }
  }

  return {
    kind: "text",
    delimiter,
    encoding: detected.encoding,
    rowCount: starts.length,
    columnCount,
    async readRows(start: number, end: number): Promise<string[][]> {
      const from = Math.max(0, Math.min(start, starts.length));
      const to = Math.max(from, Math.min(end, starts.length));
      if (to <= from) return [];
      const byteEnd = to < starts.length ? starts[to] : bytes.length;
      const window = decode(bytes.subarray(starts[from], byteEnd));
      const rows = parseCsvRecords(window, delimiter);
      // The window ends on a record boundary, so there is no partial row; a trailing newline
      // can still add one empty record, which is not a row the caller asked for.
      if (rows.length > to - from) rows.length = to - from;
      return rows;
    },
  };
}
