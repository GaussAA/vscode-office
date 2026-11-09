/**
 * Find across a windowed sheet (phase 3 of ADR-0017).
 *
 * The grid's find panel walks the cell model it already holds. The windowed view has no such
 * model — that is the point — so a search reads row blocks from the source and stops at the
 * first N matches. Same contract as the parquet search: cancel between blocks, report progress
 * in rows, and keep the earliest matches in row order so "next" is predictable.
 */
import type { SheetSource } from "./sheetSource";

/** Rows per read while scanning; a block read is a decode, so it should be worth the call. */
const DEFAULT_BATCH_ROWS = 2048;
/** Rows kept for navigation. Beyond this the result is reported as capped. */
const DEFAULT_MAX_ROWS = 5_000;
const PROGRESS_INTERVAL_MS = 100;

export interface SheetSearchOptions {
  batchRows?: number;
  maxRows?: number;
  isCancelled?: () => boolean;
  onProgress?: (scanned: number, matches: number) => void;
}

export interface SheetSearchResult {
  /** Matching row indexes in ascending order, at most `maxRows`. */
  rows: number[];
  capped: boolean;
  cancelled: boolean;
  scanned: number;
}

/**
 * Search every cell of `source` for `query`, case-insensitively.
 *
 * Matches are row indexes: a row is a hit when any of its cells contains the query, which is
 * the same rule the grid's find uses (a hit is a row you can navigate to, not a cell).
 */
export async function searchSheetRows(
  source: SheetSource,
  query: string,
  options: SheetSearchOptions = {},
): Promise<SheetSearchResult> {
  const needle = query.trim().toLowerCase();
  const rowCount = Math.max(0, source.rowCount);
  const batchRows = Math.max(1, options.batchRows ?? DEFAULT_BATCH_ROWS);
  const maxRows = Math.max(1, options.maxRows ?? DEFAULT_MAX_ROWS);
  if (!needle || rowCount === 0) {
    return { rows: [], capped: false, cancelled: false, scanned: 0 };
  }

  const rows: number[] = [];
  let scanned = 0;
  let lastProgress = 0;
  let cancelled = false;
  let capped = false;

  while (scanned < rowCount) {
    if (options.isCancelled?.() === true) {
      cancelled = true;
      break;
    }
    const end = Math.min(rowCount, scanned + batchRows);
    const block = await source.readRows(scanned, end);
    for (let offset = 0; offset < block.length; offset++) {
      const row = block[offset];
      let hit = false;
      for (let column = 0; column < row.length; column++) {
        if ((row[column] ?? "").toLowerCase().includes(needle)) {
          hit = true;
          break;
        }
      }
      if (!hit) continue;
      rows.push(scanned + offset);
      if (rows.length >= maxRows) {
        capped = true;
        break;
      }
    }
    scanned = end;
    if (capped) break;
    const now = Date.now();
    if (now - lastProgress >= PROGRESS_INTERVAL_MS) {
      lastProgress = now;
      options.onProgress?.(scanned, rows.length);
    }
  }

  options.onProgress?.(scanned, rows.length);
  return { rows, capped, cancelled: cancelled || options.isCancelled?.() === true, scanned };
}

/**
 * The next match to jump to, given where the user is now.
 *
 * Forward wraps to the first match, backward to the last: a find bar that stops at the end of
 * the file makes "next" mean "find again from the top" only by accident.
 */
export function nextMatch(
  matches: readonly number[],
  currentRow: number,
  direction: 1 | -1,
): number | undefined {
  if (matches.length === 0) return undefined;
  if (direction > 0) return matches.find((row) => row > currentRow) ?? matches[0];
  for (let index = matches.length - 1; index >= 0; index--) {
    if (matches[index] < currentRow) return matches[index];
  }
  return matches[matches.length - 1];
}
