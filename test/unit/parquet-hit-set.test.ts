import assert from "node:assert/strict";
import test from "node:test";
import { ParquetHitSet, normalizeSearchQuery } from "@/react/view/parquet/parquetHitSet";
import { ParquetSession, type ParquetRowsSource } from "@/react/view/parquet/parquetSession";

/** Fake rows source: row N contains `{value: N}`. */
const fakeSource: ParquetRowsSource = {
  rowCount: 100,
  async readRows(start: number, end: number) {
    return Array.from({ length: end - start }, (_, offset) => ({ value: start + offset }));
  },
};

test("empty hit set: step returns null", () => {
  const hits = new ParquetHitSet([], [], "needle");
  const session = new ParquetSession(fakeSource, { pageSize: 10 });

  assert.equal(hits.size, 0);
  assert.equal(hits.isEmpty, true);
  assert.equal(hits.step(1, 0, session), null);
  assert.equal(hits.step(-1, 0, session), null);
});

test("single hit: step always returns that hit", () => {
  const hits = new ParquetHitSet([5], [2], "needle");
  const session = new ParquetSession(fakeSource, { pageSize: 10 });

  assert.equal(hits.size, 1);
  const forward = hits.step(1, 0, session);
  assert.ok(forward);
  assert.equal(forward.row, 5);
  assert.equal(forward.column, 2);
  assert.equal(forward.index, 0);

  const backward = hits.step(-1, 0, session);
  assert.ok(backward);
  assert.equal(backward.row, 5);
  assert.equal(backward.column, 2);
  assert.equal(backward.index, 0);
});

test("forward: first hit at or after page end", () => {
  const hits = new ParquetHitSet([5, 15, 25, 35], [0, 1, 2, 3], "needle");
  const session = new ParquetSession(fakeSource, { pageSize: 10 });

  // Page 0 is rows [0, 10), so end=10. First hit >= 10 is row 15.
  const match = hits.step(1, 0, session);
  assert.ok(match);
  assert.equal(match.row, 15);
  assert.equal(match.column, 1);
  assert.equal(match.index, 1);
});

test("forward: wraps when no hit after page", () => {
  const hits = new ParquetHitSet([5, 15, 25], [0, 1, 2], "needle");
  const session = new ParquetSession(fakeSource, { pageSize: 10 });

  // Page 3 is rows [30, 40). No hit >= 40, so wrap to the first hit.
  const match = hits.step(1, 3, session);
  assert.ok(match);
  assert.equal(match.row, 5);
  assert.equal(match.column, 0);
  assert.equal(match.index, 0);
});

test("backward: last hit before page start", () => {
  const hits = new ParquetHitSet([5, 15, 25, 35], [0, 1, 2, 3], "needle");
  const session = new ParquetSession(fakeSource, { pageSize: 10 });

  // Page 2 is rows [20, 30), so start=20. Last hit < 20 is row 15.
  const match = hits.step(-1, 2, session);
  assert.ok(match);
  assert.equal(match.row, 15);
  assert.equal(match.column, 1);
  assert.equal(match.index, 1);
});

test("backward: wraps when no hit before page", () => {
  const hits = new ParquetHitSet([15, 25, 35], [0, 1, 2], "needle");
  const session = new ParquetSession(fakeSource, { pageSize: 10 });

  // Page 0 is rows [0, 10), so start=0. No hit < 0, so wrap to the last hit.
  const match = hits.step(-1, 0, session);
  assert.ok(match);
  assert.equal(match.row, 35);
  assert.equal(match.column, 2);
  assert.equal(match.index, 2);
});

test("step skips hits on the current page", () => {
  const hits = new ParquetHitSet([5, 12, 18, 25], [0, 1, 2, 3], "needle");
  const session = new ParquetSession(fakeSource, { pageSize: 10 });

  // Page 1 is rows [10, 20). Hits 12 and 18 are on this page.
  // Forward: first hit >= 20 is row 25.
  const forward = hits.step(1, 1, session);
  assert.ok(forward);
  assert.equal(forward.row, 25);
  assert.equal(forward.index, 3);

  // Backward: last hit < 10 is row 5.
  const backward = hits.step(-1, 1, session);
  assert.ok(backward);
  assert.equal(backward.row, 5);
  assert.equal(backward.index, 0);
});

test("rowSet returns all matching rows as a Set", () => {
  const hits = new ParquetHitSet([5, 15, 25], [0, 1, 2], "needle");

  const set = hits.rowSet;
  assert.equal(set.size, 3);
  assert.equal(set.has(5), true);
  assert.equal(set.has(15), true);
  assert.equal(set.has(25), true);
  assert.equal(set.has(10), false);
  assert.equal(hits.rowSet, set, "rowSet returns the same instance");
});

test("isFor: true when the query normalises to the search text", () => {
  const hits = new ParquetHitSet([5], [0], "needle");

  assert.equal(hits.isFor("needle"), true);
  assert.equal(hits.isFor("Needle"), true);
  assert.equal(hits.isFor(" NEEDLE "), true);
  assert.equal(hits.isFor("haystack"), false);
  assert.equal(hits.isFor(""), false);
});

test("at: returns the match at index, or undefined", () => {
  const hits = new ParquetHitSet([5, 15, 25], [10, 20, 30], "needle");

  const first = hits.at(0);
  assert.ok(first);
  assert.equal(first.row, 5);
  assert.equal(first.column, 10);
  assert.equal(first.index, 0);

  assert.equal(hits.at(3), undefined);
  assert.equal(hits.at(-1), undefined);
  assert.equal(hits.at(1.5), undefined);
});

test("constructor: sorts unsorted rows and deduplicates", () => {
  const hits = new ParquetHitSet([25, 5, 15, 5], [3, 0, 1, 99], "needle");

  assert.equal(hits.size, 3);
  const match0 = hits.at(0);
  const match1 = hits.at(1);
  const match2 = hits.at(2);
  assert.ok(match0 && match1 && match2);
  assert.equal(match0.row, 5);
  assert.equal(match0.column, 0);
  assert.equal(match1.row, 15);
  assert.equal(match2.row, 25);
});

test("normalizeSearchQuery: trims and lowercases", () => {
  assert.equal(normalizeSearchQuery(" Needle "), "needle");
  assert.equal(normalizeSearchQuery("ABC"), "abc");
  assert.equal(normalizeSearchQuery(""), "");
});

test("forward wrap when hits only exist before the current page", () => {
  const hits = new ParquetHitSet([5, 15], [0, 1], "needle");
  const session = new ParquetSession(fakeSource, { pageSize: 10 });

  // Page 3 is rows [30, 40). All hits are before page 3, so forward wraps to the first.
  const match = hits.step(1, 3, session);
  assert.ok(match);
  assert.equal(match.row, 5);
  assert.equal(match.index, 0);
});

test("backward wrap when hits only exist after the current page", () => {
  const hits = new ParquetHitSet([35, 45], [0, 1], "needle");
  const session = new ParquetSession(fakeSource, { pageSize: 10 });

  // Page 1 is rows [10, 20). All hits are after page 1, so backward wraps to the last.
  const match = hits.step(-1, 1, session);
  assert.ok(match);
  assert.equal(match.row, 45);
  assert.equal(match.index, 1);
});
