/**
 * Whole-file search for the parquet viewer.
 *
 * The old implementation walked the file in 5000-row batches, calling
 * `parquetReadObjects` once per batch. hyparquet cannot random-access inside a row group
 * without an offset index, so every batch re-decoded the whole data page that contained
 * it: a 1M-row file (a single PyArrow-default row group) meant ~200 batches × one page of
 * every column. Measured: 28 s for 5 columns, 40 s for 60.
 *
 * A full-file search has to touch every value once anyway, so this decodes each column
 * once, page by page, and records the hit *rows* in a bitset. The work is now the
 * theoretical minimum (one pass), memory is one column plus one byte per row, and the
 * result is still "the first N matching rows in row order".
 *
 * Nested columns (LIST/MAP/STRUCT) are the exception: their physical pages are values,
 * not rows, so a page cannot be mapped back to a row index. Those go through the assembled
 * row reader in chunks — a few such columns are normal, and their cost is no worse than the
 * old batch loop.
 */
import { parquetRead, parquetReadObjects, type FileMetaData } from "hyparquet";
import { compressors } from "hyparquet-compressors";
import type { AsyncBuffer } from "hyparquet";
import { formatCellValue, type ParquetColumnInfo, type ParquetFileInfo } from "./parquetParser";

/** Rows per assembled read for a nested column. */
const NESTED_CHUNK_ROWS = 20_000;

/** Progress updates are for a percentage readout; one per frame is already too many. */
const PROGRESS_INTERVAL_MS = 100;

export interface ParquetSearchOptions {
  /** Rows kept in the result; earlier rows win. Defaults to 5,000. */
  maxRows?: number;
  isCancelled?: () => boolean;
  onProgress?: (scanned: number, matches: number) => void;
}

export interface ParquetSearchResult {
  /** Matching row indexes in ascending order, at most `maxRows` of them. */
  rows: number[];
  /** True when the file matched more rows than were kept. */
  capped: boolean;
  cancelled: boolean;
  /** Rows examined; the whole file unless cancelled. */
  scanned: number;
}

/** Thrown from the page callback to stop a read that is already in flight. */
class SearchCancelled extends Error {
  constructor() {
    super("parquet search cancelled");
    this.name = "SearchCancelled";
  }
}

const DEFAULT_MAX_ROWS = 5_000;

/**
 * Search every column for `query`, case-insensitively, as display text.
 *
 * A row matches when any of its columns contains the query — the same rule the table's
 * per-cell rendering uses (`formatCellValue`), so a hit always has visible text.
 */
export async function searchParquetValues(
  info: Pick<ParquetFileInfo, "file" | "metadata" | "columns" | "rowCount">,
  query: string,
  options: ParquetSearchOptions = {},
): Promise<ParquetSearchResult> {
  const needle = query.trim().toLowerCase();
  const rowCount = Math.max(0, info.rowCount);
  const maxRows = Math.max(1, options.maxRows ?? DEFAULT_MAX_ROWS);
  if (!needle || rowCount === 0) {
    return { rows: [], capped: false, cancelled: false, scanned: 0 };
  }

  const hits = new Uint8Array(rowCount);
  let matches = 0;
  const mark = (row: number) => {
    if (row < 0 || row >= rowCount || hits[row]) return;
    hits[row] = 1;
    matches++;
  };

  const columnCount = Math.max(1, info.columns.length);
  let lastProgress = 0;
  const report = (columnIndex: number, withinColumn: number, force = false) => {
    if (!options.onProgress) return;
    const now = Date.now();
    if (!force && now - lastProgress < PROGRESS_INTERVAL_MS) return;
    lastProgress = now;
    const fraction = (columnIndex + Math.min(1, Math.max(0, withinColumn))) / columnCount;
    options.onProgress(Math.round(fraction * rowCount), matches);
  };

  const cancelled = () => options.isCancelled?.() === true;
  const checkCancelled = () => {
    if (cancelled()) throw new SearchCancelled();
  };

  let stopped = false;
  try {
    for (let index = 0; index < info.columns.length; index++) {
      checkCancelled();
      const column = info.columns[index];
      if (column.nested) {
        await scanNestedColumn(info.file, info.metadata, column, needle, mark, {
          rowCount,
          checkCancelled,
          onRow: (row) => report(index, row / Math.max(1, rowCount)),
        });
      } else {
        await scanFlatColumn(info.file, info.metadata, column, needle, mark, {
          rowCount,
          checkCancelled,
          onRow: (row) => report(index, row / Math.max(1, rowCount)),
        });
      }
      report(index + 1, 0, true);
    }
  } catch (error) {
    if (error instanceof SearchCancelled) stopped = true;
    else throw error;
  }

  const rows: number[] = [];
  for (let row = 0; row < rowCount && rows.length < maxRows; row++) {
    if (hits[row]) rows.push(row);
  }
  options.onProgress?.(rowCount, matches);

  return {
    rows,
    capped: matches > rows.length,
    cancelled: stopped || cancelled(),
    scanned: stopped ? 0 : rowCount,
  };
}

interface ScanHooks {
  rowCount: number;
  checkCancelled: () => void;
  onRow: (row: number) => void;
}

/**
 * One page-aligned pass over a flat column.
 *
 * `onPage` hands over pages as they decode, in file order, so each page is decompressed
 * exactly once — this is the whole point of the rewrite.
 */
async function scanFlatColumn(
  file: AsyncBuffer,
  metadata: FileMetaData,
  column: ParquetColumnInfo,
  needle: string,
  mark: (row: number) => void,
  hooks: ScanHooks,
): Promise<void> {
  let lastRow = -1;
  await parquetRead({
    file,
    metadata,
    columns: [column.name],
    compressors,
    onPage: ({ columnData, rowStart }) => {
      hooks.checkCancelled();
      for (let offset = 0; offset < columnData.length; offset++) {
        if (formatCellValue(columnData[offset]).toLowerCase().includes(needle)) {
          mark(rowStart + offset);
        }
      }
      if (rowStart !== lastRow) {
        lastRow = rowStart;
        hooks.onRow(rowStart);
      }
    },
  });
}

/**
 * Nested columns are read as assembled rows: their physical pages do not map to row
 * indexes, so a page-level pass cannot say which row a match belongs to.
 */
async function scanNestedColumn(
  file: AsyncBuffer,
  metadata: FileMetaData,
  column: ParquetColumnInfo,
  needle: string,
  mark: (row: number) => void,
  hooks: ScanHooks,
): Promise<void> {
  for (let start = 0; start < hooks.rowCount; start += NESTED_CHUNK_ROWS) {
    hooks.checkCancelled();
    const end = Math.min(hooks.rowCount, start + NESTED_CHUNK_ROWS);
    const rows = await parquetReadObjects({
      file,
      metadata,
      columns: [column.name],
      rowStart: start,
      rowEnd: end,
      rowFormat: "object",
      compressors,
    });
    for (let offset = 0; offset < rows.length; offset++) {
      if (formatCellValue(rows[offset][column.name]).toLowerCase().includes(needle)) {
        mark(start + offset);
      }
    }
    hooks.onRow(end);
  }
}
