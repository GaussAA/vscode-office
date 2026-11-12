/**
 * The column profile, answered from row-group metadata only.
 *
 * Why this lives in `src/service`: the parquet read path (byte source, paging, search) is still
 * in the webview, and ADR-0020 raises it to the host one capability at a time. The profile is
 * the first capability, and it is the one that must never decode a column — so it is also the
 * one that has to be testable without a browser.
 *
 * It does import `openParquetFile` from the webview's parser. That is deliberate: the parser is
 * the single place a parquet type string is decoded (`categorizeType`), and re-deriving column
 * types host-side would create the second place that can disagree with the schema rail.
 */
import type { AsyncBuffer, FileMetaData } from "hyparquet";
import type {
  ParquetColumnProfile,
  ParquetProfile,
  ParquetProfileState,
} from "@/common/parquetProfileTypes";
import { openParquetFile, type ParquetColumnInfo } from "@/react/view/parquet/parquetParser";
import type { ByteSource } from "@/service/jsonlFile";

/** The shapes hyparquet hands back for a statistics min/max. */
type MinMax = bigint | boolean | number | string | Date | Uint8Array;

/** Footer magic (4 bytes) plus the metadata length (4 bytes). Nothing else is needed up front. */
const PROFILE_TAIL_PROBE_BYTES = 8;

/**
 * Take `[start, end)` straight from a host byte source.
 *
 * hyparquet only asks for the footer and the pages it needs, so this wrapper is what keeps a
 * profile from becoming a whole-file read: `parquetMetadataAsync` reads the last eight bytes and
 * then the footer, and nothing else.
 */
export function asyncBufferFrom(source: ByteSource): AsyncBuffer {
  return {
    byteLength: source.size,
    async slice(start: number, end?: number): Promise<ArrayBuffer> {
      const from = Math.max(0, Math.min(start, source.size));
      const to = Math.max(from, Math.min(end ?? source.size, source.size));
      if (to <= from) return new ArrayBuffer(0);
      const bytes = await source.read(from, to - from);
      // `read` may return a view over a larger buffer; hyparquet wants exactly these bytes.
      const exact = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      return exact as ArrayBuffer;
    },
  };
}

function formatExtreme(value: MinMax): string {
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(value);
    } catch {
      return `0x${Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
    }
  }
  return String(value);
}

function compareExtreme(left: MinMax, right: MinMax): number {
  if (left instanceof Uint8Array && right instanceof Uint8Array) {
    const length = Math.min(left.length, right.length);
    for (let index = 0; index < length; index++) {
      if (left[index] !== right[index]) return left[index] - right[index];
    }
    return left.length - right.length;
  }
  if (left instanceof Date && right instanceof Date) return left.getTime() - right.getTime();
  if (typeof left === "bigint" && typeof right === "bigint") {
    return left < right ? -1 : left > right ? 1 : 0;
  }
  if (typeof left === "number" && typeof right === "number") return left - right;
  if (typeof left === "boolean" && typeof right === "boolean") {
    return Number(left) - Number(right);
  }
  if (typeof left === "string" && typeof right === "string") {
    return left < right ? -1 : left > right ? 1 : 0;
  }
  // A writer that mixes shapes in one column is broken; compare text so it cannot throw.
  return formatExtreme(left).localeCompare(formatExtreme(right));
}

function pickExtreme(current: MinMax | undefined, candidate: MinMax, kind: "min" | "max"): MinMax {
  if (current === undefined) return candidate;
  const order = compareExtreme(candidate, current);
  if (kind === "min") return order < 0 ? candidate : current;
  return order > 0 ? candidate : current;
}

interface Aggregate {
  column: ParquetColumnInfo;
  /** Row groups whose column chunk existed at all. */
  groups: number;
  /** Row groups that carried a statistics struct for this column. */
  groupsWithStatistics: number;
  nulls: number;
  nullGroups: number;
  min?: MinMax;
  max?: MinMax;
}

function stateOf(aggregate: Aggregate, rowGroupCount: number): ParquetProfileState {
  if (aggregate.column.nested) return "nested";
  if (aggregate.groupsWithStatistics === 0) return "missing";
  return aggregate.groupsWithStatistics < rowGroupCount ? "partial" : "available";
}

/**
 * Aggregate per-row-group statistics into one answer per top-level column.
 *
 * A partial answer is reported as partial rather than summed into a total: three of ten row
 * groups is a fact about three row groups, and calling it "the column's nulls" would be a lie
 * the UI cannot detect.
 */
export function profileFromParquet(info: {
  metadata: FileMetaData;
  columns: ParquetColumnInfo[];
}): ParquetProfile {
  const rowGroups = info.metadata.row_groups ?? [];
  const rowCount = Number(info.metadata.num_rows ?? 0);
  const aggregates = new Map<string, Aggregate>();
  for (const column of info.columns) {
    aggregates.set(column.name, {
      column,
      groups: 0,
      groupsWithStatistics: 0,
      nulls: 0,
      nullGroups: 0,
    });
  }

  for (const group of rowGroups) {
    for (const chunk of group.columns) {
      const top = chunk.meta_data?.path_in_schema?.[0];
      const aggregate = top === undefined ? undefined : aggregates.get(top);
      // A nested column's statistics describe its leaves, not the value in a row.
      if (!aggregate || aggregate.column.nested) continue;
      aggregate.groups += 1;
      const stats = chunk.meta_data?.statistics;
      if (!stats) continue;
      aggregate.groupsWithStatistics += 1;
      if (stats.null_count !== undefined) {
        aggregate.nulls += Number(stats.null_count);
        aggregate.nullGroups += 1;
      }
      const min = stats.min_value ?? stats.min;
      const max = stats.max_value ?? stats.max;
      if (min !== undefined) aggregate.min = pickExtreme(aggregate.min, min, "min");
      if (max !== undefined) aggregate.max = pickExtreme(aggregate.max, max, "max");
    }
  }

  const columns: ParquetColumnProfile[] = [...aggregates.values()].map((aggregate) => {
    const state = stateOf(aggregate, rowGroups.length);
    const coversEveryGroup = aggregate.groupsWithStatistics === rowGroups.length;
    const profile: ParquetColumnProfile = {
      name: aggregate.column.name,
      type: aggregate.column.type,
      state,
      groupsWithStatistics: aggregate.groupsWithStatistics,
    };
    // A null count summed over some groups is still a fact about those groups; a *ratio*
    // against the whole file is not, so it is only offered when every group reported.
    if (aggregate.nullGroups > 0) profile.nullCount = aggregate.nulls;
    if (coversEveryGroup && aggregate.nullGroups === rowGroups.length && rowCount > 0) {
      profile.nullRatio = aggregate.nulls / rowCount;
    }
    if (aggregate.min !== undefined) profile.min = formatExtreme(aggregate.min);
    if (aggregate.max !== undefined) profile.max = formatExtreme(aggregate.max);
    return profile;
  });

  return {
    rowCount,
    rowGroupCount: rowGroups.length,
    columns,
    hasAnyStatistics: columns.some(
      (column) => column.state === "available" || column.state === "partial",
    ),
  };
}

/** Open the metadata through `source` and answer the profile. Reads no data page. */
export async function readParquetProfile(source: ByteSource): Promise<ParquetProfile> {
  const info = await openParquetFile(asyncBufferFrom(source), {
    // `8` is the footer magic plus the metadata length. hyparquet's default 512 KB tail fetch
    // would pull more than the file itself on anything small, which is exactly the byte count
    // this path is supposed to keep at zero.
    initialFetchSize: PROFILE_TAIL_PROBE_BYTES,
  });
  return profileFromParquet(info);
}
