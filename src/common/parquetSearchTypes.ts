/**
 * Wire format for a whole-file parquet search.
 *
 * The scan runs in the extension host (ADR-0031): the webview sends a query plus the column
 * positions to scan, and receives progress and one final hit list. `columns` is empty/absent
 * for "every column"; otherwise it holds absolute schema positions, so a scoped search reports
 * the same column index the table uses, not an index into the subset.
 */

/** Hard cap on kept hits; earlier rows win. */
export const PARQUET_SEARCH_MAX_ROWS = 5_000;

export interface ParquetSearchRequest {
  requestId: number;
  query: string;
  /** Absolute top-level column positions to scan; omitted means every column. */
  columns?: number[];
}

export interface ParquetSearchProgress {
  requestId: number;
  /** Rows examined so far, projected across the selected columns. */
  scanned: number;
  total: number;
  matches: number;
}

export interface ParquetSearchData {
  requestId: number;
  /** Null on failure; the reply is still sent so the caller stops waiting. */
  rows: number[] | null;
  /** First matching column per row, parallel to `rows`. */
  columns: number[];
  rowCount: number;
  capped: boolean;
  cancelled: boolean;
  scanned: number;
  error?: string;
}

export interface ParquetSearchCancel {
  requestId: number;
}
