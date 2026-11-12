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
