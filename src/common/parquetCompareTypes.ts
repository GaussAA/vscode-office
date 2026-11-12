/**
 * Wire format for the two-file comparison (ADR-0021).
 *
 * A comparison is a diff of **columns**, not of rows: it is answered from two column profiles,
 * so it never decodes a value. That is also why `added`/`removed` are properties of a column
 * rather than of a record.
 */
import type { ParquetColumnProfile, ParquetProfile } from "./parquetProfileTypes";

/** One side's identity, as the panel header shows it. */
export interface ParquetCompareSide {
  fileName: string;
  rowCount: number;
  rowGroupCount: number;
  columnCount: number;
  /** False when the file carries no statistics at all — every shared column is then blind. */
  hasAnyStatistics: boolean;
}

/**
 * What happened to one column.
 *
 * `added` means "present on the right, absent on the left" — the right side is the newer file
 * by convention of the picker order, not by any timestamp. `uncomparable` is not a failure: it
 * says one side cannot answer (no statistics, or a nested column), which is different from
 * "nothing changed".
 */
export type ParquetCompareState =
  | "same"
  | "changed"
  | "added"
  | "removed"
  | "type-changed"
  | "uncomparable";

export interface ParquetColumnDiff {
  name: string;
  state: ParquetCompareState;
  left?: ParquetColumnProfile;
  right?: ParquetColumnProfile;
  /** `right.nullRatio - left.nullRatio`, present only when both sides reported one. */
  nullRatioDelta?: number;
}

export interface ParquetCompare {
  left: ParquetCompareSide;
  right: ParquetCompareSide;
  /** `right.rowCount - left.rowCount`. A difference is a finding, not an error. */
  rowCountDelta: number;
  columns: ParquetColumnDiff[];
  summary: Record<ParquetCompareState, number>;
}

/** What the host needs from each side to answer. */
export interface ParquetCompareRequest {
  requestId: number;
  leftPath: string;
  rightPath: string;
}

export interface ParquetComparePayload {
  requestId: number;
  compare: ParquetCompare | null;
  /** Which side failed, so the panel can point at the file instead of the feature. */
  failedSide?: "left" | "right";
  error?: string;
}

/** A profile plus its file name, the shape `compareParquetProfiles` takes. */
export interface NamedParquetProfile {
  fileName: string;
  profile: ParquetProfile;
}
