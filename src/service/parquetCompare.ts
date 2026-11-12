/**
 * Two column profiles in, one per-column diff out.
 *
 * Pure on purpose (ADR-0021): "what counts as a change" is the whole design of this feature, so
 * it must be testable without a parquet file, a browser or a panel. Everything here works on
 * the profiles that `readParquetProfile` already returns; nothing decodes a value.
 */
import type {
  NamedParquetProfile,
  ParquetColumnDiff,
  ParquetCompare,
  ParquetCompareSide,
  ParquetCompareState,
} from "@/common/parquetCompareTypes";
import type { ParquetColumnProfile } from "@/common/parquetProfileTypes";

/**
 * How much a null ratio may move before it is a change.
 *
 * A tenth of a percentage point: below that the difference is writer/statistics noise, not
 * something worth a red row. Without a threshold every file looks changed and the panel stops
 * being a finding.
 */
export const NULL_RATIO_TOLERANCE = 0.001;

function sideOf(named: NamedParquetProfile): ParquetCompareSide {
  const { profile } = named;
  return {
    fileName: named.fileName,
    rowCount: profile.rowCount,
    rowGroupCount: profile.rowGroupCount,
    columnCount: profile.columns.length,
    hasAnyStatistics: profile.hasAnyStatistics,
  };
}

/**
 * Both sides must answer the same question for a comparison to mean anything: a `missing` or
 * `partial` answer describes the writer, not the column, and a nested column has no row value.
 */
function comparable(left: ParquetColumnProfile, right: ParquetColumnProfile): boolean {
  return left.state === "available" && right.state === "available";
}

function sameStatistics(
  left: ParquetColumnProfile,
  right: ParquetColumnProfile,
  nullRatioDelta: number | undefined,
): boolean {
  if (nullRatioDelta !== undefined && Math.abs(nullRatioDelta) > NULL_RATIO_TOLERANCE) return false;
  // `min`/`max` are display strings by the time they reach the wire; equality on them is the
  // same comparison the panel shows the reader.
  return left.min === right.min && left.max === right.max;
}

function diffOf(
  left: ParquetColumnProfile | undefined,
  right: ParquetColumnProfile | undefined,
): ParquetColumnDiff {
  if (!left && right) return { name: right.name, state: "added", right };
  if (left && !right) return { name: left.name, state: "removed", left };

  const columnLeft = left as ParquetColumnProfile;
  const columnRight = right as ParquetColumnProfile;
  const bothRatios =
    columnLeft.nullRatio !== undefined && columnRight.nullRatio !== undefined
      ? columnRight.nullRatio - columnLeft.nullRatio
      : undefined;

  if (columnLeft.type !== columnRight.type) {
    // A type change makes the range meaningless to compare, but the null share is still a fact
    // about both files, so it travels with the row.
    return {
      name: columnLeft.name,
      state: "type-changed",
      left: columnLeft,
      right: columnRight,
      ...(bothRatios === undefined ? {} : { nullRatioDelta: bothRatios }),
    };
  }

  if (!comparable(columnLeft, columnRight)) {
    return {
      name: columnLeft.name,
      state: "uncomparable",
      left: columnLeft,
      right: columnRight,
      ...(bothRatios === undefined ? {} : { nullRatioDelta: bothRatios }),
    };
  }

  const state: ParquetCompareState = sameStatistics(columnLeft, columnRight, bothRatios)
    ? "same"
    : "changed";
  return {
    name: columnLeft.name,
    state,
    left: columnLeft,
    right: columnRight,
    ...(bothRatios === undefined ? {} : { nullRatioDelta: bothRatios }),
  };
}

function emptySummary(): Record<ParquetCompareState, number> {
  return { same: 0, changed: 0, added: 0, removed: 0, "type-changed": 0, uncomparable: 0 };
}

/**
 * Compare two profiles by column name.
 *
 * Order is deliberate: shared columns keep the left file's order (that is how the reader knows
 * the old table), then columns only the right file has (`added`), then columns the left file
 * lost (`removed`). A panel that sorted alphabetically would hide exactly the drift it exists
 * to show.
 */
export function compareParquetProfiles(
  left: NamedParquetProfile,
  right: NamedParquetProfile,
): ParquetCompare {
  const rightByName = new Map(right.profile.columns.map((column) => [column.name, column]));
  const leftNames = new Set(left.profile.columns.map((column) => column.name));

  const shared: ParquetColumnDiff[] = [];
  const leftOnly: ParquetColumnDiff[] = [];
  for (const column of left.profile.columns) {
    const counterpart = rightByName.get(column.name);
    const diff = diffOf(column, counterpart);
    (counterpart ? shared : leftOnly).push(diff);
  }

  const rightOnly: ParquetColumnDiff[] = [];
  for (const column of right.profile.columns) {
    if (leftNames.has(column.name)) continue;
    rightOnly.push(diffOf(undefined, column));
  }

  const columns = [...shared, ...rightOnly, ...leftOnly];
  const summary = emptySummary();
  for (const column of columns) summary[column.state] += 1;

  return {
    left: sideOf(left),
    right: sideOf(right),
    rowCountDelta: right.profile.rowCount - left.profile.rowCount,
    columns,
    summary,
  };
}
