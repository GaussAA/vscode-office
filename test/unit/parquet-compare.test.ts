import assert from "node:assert/strict";
import test from "node:test";
import type { NamedParquetProfile } from "@/common/parquetCompareTypes";
import type { ParquetColumnProfile, ParquetProfile } from "@/common/parquetProfileTypes";
import { NULL_RATIO_TOLERANCE, compareParquetProfiles } from "@/service/parquetCompare";

/**
 * The comparison is a pure function over two profiles, so these tests hand-build the profiles.
 * That is the point: "what counts as a change" is the design, and it must be assertable without
 * a parquet file, a browser or a panel.
 */

function column(name: string, overrides: Partial<ParquetColumnProfile> = {}): ParquetColumnProfile {
  return {
    name,
    type: "INT32",
    state: "available",
    groupsWithStatistics: 1,
    nullCount: 0,
    nullRatio: 0,
    min: "1",
    max: "100",
    ...overrides,
  };
}

function profile(columns: ParquetColumnProfile[], rowCount = 1000): ParquetProfile {
  return {
    rowCount,
    rowGroupCount: 1,
    columns,
    hasAnyStatistics: columns.some((entry) => entry.state === "available"),
  };
}

function named(
  fileName: string,
  columns: ParquetColumnProfile[],
  rowCount = 1000,
): NamedParquetProfile {
  return { fileName, profile: profile(columns, rowCount) };
}

test("compare: identical profiles are all same, and the summary counts them", () => {
  const left = named("a.parquet", [column("id"), column("name", { type: "UTF8" })]);
  const right = named("b.parquet", [column("id"), column("name", { type: "UTF8" })]);

  const compare = compareParquetProfiles(left, right);

  assert.deepEqual(
    compare.columns.map((entry) => entry.state),
    ["same", "same"],
  );
  assert.deepEqual(compare.summary, {
    same: 2,
    changed: 0,
    added: 0,
    removed: 0,
    "type-changed": 0,
    uncomparable: 0,
  });
  assert.equal(compare.rowCountDelta, 0);
  assert.equal(compare.left.columnCount, 2);
});

test("compare: a column only the right file has is added, and comes before removed ones", () => {
  const left = named("a.parquet", [column("id"), column("gone")]);
  const right = named("b.parquet", [column("id"), column("fresh")]);

  const compare = compareParquetProfiles(left, right);

  assert.deepEqual(
    compare.columns.map((entry) => `${entry.name}:${entry.state}`),
    ["id:same", "fresh:added", "gone:removed"],
  );
  assert.equal(compare.summary.added, 1);
  assert.equal(compare.summary.removed, 1);
  // The side that is missing is absent, not filled with a zero profile.
  const added = compare.columns[1];
  assert.equal(added.left, undefined);
  assert.equal(added.right?.name, "fresh");
});

test("compare: a type change is its own state, so a meaningless range is never compared", () => {
  const left = named("a.parquet", [column("id", { type: "INT32" })]);
  const right = named("b.parquet", [column("id", { type: "UTF8", min: "a", max: "z" })]);

  const compare = compareParquetProfiles(left, right);
  const id = compare.columns[0];

  assert.equal(id.state, "type-changed");
  assert.equal(id.left?.type, "INT32");
  assert.equal(id.right?.type, "UTF8");
});

test("compare: a moved null ratio is changed, but only past the tolerance", () => {
  const base = column("id", { nullRatio: 0 });
  const inside = column("id", { nullRatio: NULL_RATIO_TOLERANCE / 2 });
  const outside = column("id", { nullRatio: 0.02 });

  const within = compareParquetProfiles(named("a", [base]), named("b", [inside]));
  assert.equal(within.columns[0].state, "same", "noise must not read as a change");

  const beyond = compareParquetProfiles(named("a", [base]), named("b", [outside]));
  assert.equal(beyond.columns[0].state, "changed");
  assert.equal(beyond.columns[0].nullRatioDelta, 0.02);
});

test("compare: a different range with the same null ratio is changed", () => {
  const compare = compareParquetProfiles(
    named("a", [column("id", { min: "1", max: "10" })]),
    named("b", [column("id", { min: "1", max: "20" })]),
  );
  assert.equal(compare.columns[0].state, "changed");
});

test("compare: no statistics on either side is uncomparable, not same", () => {
  const missing = column("id", {
    state: "missing",
    groupsWithStatistics: 0,
    nullCount: undefined,
    nullRatio: undefined,
    min: undefined,
    max: undefined,
  });

  const compare = compareParquetProfiles(named("a", [missing]), named("b", [missing]));

  assert.equal(compare.columns[0].state, "uncomparable");
  assert.equal(compare.summary.uncomparable, 1);
  assert.equal(compare.summary.same, 0);
});

test("compare: one side partial is uncomparable too — a prefix is not a total", () => {
  const partial = column("id", { state: "partial", groupsWithStatistics: 1, nullRatio: undefined });
  const compare = compareParquetProfiles(named("a", [column("id")]), named("b", [partial]));
  assert.equal(compare.columns[0].state, "uncomparable");
});

test("compare: a nested column has no row value to compare", () => {
  const nested = column("tags", {
    type: "LIST",
    state: "nested",
    groupsWithStatistics: 0,
    nullCount: undefined,
    nullRatio: undefined,
    min: undefined,
    max: undefined,
  });
  const compare = compareParquetProfiles(named("a", [nested]), named("b", [nested]));
  assert.equal(compare.columns[0].state, "uncomparable");
});

test("compare: a row-count difference is a finding, not an error", () => {
  const compare = compareParquetProfiles(
    named("a.parquet", [column("id")], 1000),
    named("b.parquet", [column("id")], 1050),
  );

  assert.equal(compare.rowCountDelta, 50);
  assert.equal(compare.left.rowCount, 1000);
  assert.equal(compare.right.rowCount, 1050);
  assert.equal(compare.columns[0].state, "same");
});

test("compare: an empty column list on one side lists the other side as added", () => {
  const compare = compareParquetProfiles(named("a", []), named("b", [column("id")]));
  assert.deepEqual(
    compare.columns.map((entry) => entry.state),
    ["added"],
  );
  assert.equal(compare.left.columnCount, 0);
});
