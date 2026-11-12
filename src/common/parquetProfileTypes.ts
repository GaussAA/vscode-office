/**
 * Wire format for the parquet column profile.
 *
 * A profile is answered from row-group metadata: null counts and value ranges come from column
 * statistics. Those are **optional in the format**, and a nested column's statistics describe
 * its leaves rather than its rows, so "no answer" is a state on the wire instead of a zero. The
 * UI has to say which state it is in; a silently empty range reads as "this column is empty".
 */

/** Why a column has (or has not) an answer. */
export type ParquetProfileState =
  /** Every row group reported statistics; the range and null ratio describe the whole column. */
  | "available"
  /** Some row groups reported statistics; the numbers describe only those groups. */
  | "partial"
  /** No row group reported statistics; the writer omitted them. */
  | "missing"
  /** A LIST/STRUCT column: leaf statistics do not describe the value in a row. */
  | "nested";

export interface ParquetColumnProfile {
  name: string;
  /** Display type from the schema — the same string the schema rail shows. */
  type: string;
  state: ParquetProfileState;
  /** Row groups that reported statistics for this column. */
  groupsWithStatistics: number;
  /** Summed over the row groups that reported a null count. */
  nullCount?: number;
  /** `nullCount / rowCount`, present only when the answer covers every row group. */
  nullRatio?: number;
  min?: string;
  max?: string;
}

export interface ParquetProfile {
  rowCount: number;
  rowGroupCount: number;
  columns: ParquetColumnProfile[];
  /** False when no column chunk in the file carries statistics at all. */
  hasAnyStatistics: boolean;
}

export interface ParquetProfileRequest {
  requestId: number;
}

export interface ParquetProfilePayload {
  requestId: number;
  /** Null on failure; the reply is still sent, otherwise the caller waits forever. */
  profile: ParquetProfile | null;
  error?: string;
}

/**
 * The on-demand half of the profile: cardinality and top-N for **one** column.
 *
 * This one decodes, so it is a separate request from the metadata answer and it reports what it
 * actually covered. A scan is a prefix, never a promise about the whole file.
 */
export interface ParquetColumnScanRequest {
  requestId: number;
  name: string;
}

export interface ParquetColumnScanValue {
  /** Display text, already truncated for the panel; the row's identity for counting. */
  value: string;
  count: number;
}

export interface ParquetColumnScan {
  name: string;
  /** Rows the scan read. Equals `rowCount` when `complete`. */
  scanned: number;
  rowCount: number;
  /** False when the row cap stopped the scan; the numbers describe the prefix only. */
  complete: boolean;
  /** Distinct non-null values in the scanned prefix. */
  distinct: number;
  /** Nulls seen and skipped — the profile already reports their share. */
  nulls: number;
  top: ParquetColumnScanValue[];
}

export interface ParquetColumnScanPayload {
  requestId: number;
  scan: ParquetColumnScan | null;
  error?: string;
}
