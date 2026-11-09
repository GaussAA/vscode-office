import assert from "node:assert/strict";
import test from "node:test";
import { ParquetSession } from "@/react/view/parquet/parquetSession";

/**
 * A fake row reader shaped like the real one: `readRows(start, end)` returns objects.
 * `calls` records every range so tests can prove the cache and prefetch actually work.
 */
function makeSource(rowCount: number, { delay = 0 }: { delay?: number } = {}) {
  const calls: Array<[number, number]> = [];
  return {
    rowCount,
    calls,
    async readRows(start: number, end: number) {
      calls.push([start, end]);
      if (delay) await new Promise<void>((resolve) => setTimeout(resolve, delay));
      const rows: Array<{ id: number; name: string }> = [];
      for (let index = start; index < end; index++) {
        rows.push({ id: index, name: `row-${index}` });
      }
      return rows;
    },
  };
}

test("pages: totals, ranges and the last short page", async () => {
  const source = makeSource(120);
  const session = new ParquetSession(source);

  assert.equal(session.rowCount, 120);
  assert.equal(session.totalPages, 3);
  assert.equal(session.pageSize, 50);

  const first = await session.showPage(0);
  assert.deepEqual([first.start, first.end, first.rows.length, first.stale], [0, 50, 50, false]);

  const last = await session.showPage(2);
  assert.deepEqual([last.start, last.end, last.rows.length], [100, 120, 20]);
  assert.equal(session.page, 2);
});

test("pages: out-of-range page clamps to the last page", async () => {
  const session = new ParquetSession(makeSource(120));
  const snapshot = await session.showPage(99);
  assert.equal(snapshot.page, 2);
  assert.deepEqual(session.pageOf(120 - 1), 2);
  assert.equal(session.startOf(2), 100);
});

test("cache: revisiting a page does not re-read it", async () => {
  const source = makeSource(300);
  const session = new ParquetSession(source);

  await session.showPage(0);
  await session.showPage(1);
  await session.showPage(0);

  assert.deepEqual(source.calls, [
    [0, 50],
    [50, 100],
  ]);
});

test("cache: bounded to maxCachedPages", async () => {
  const source = makeSource(500);
  const session = new ParquetSession(source, { maxCachedPages: 2 });

  for (const page of [0, 1, 2, 3]) await session.showPage(page);
  await session.showPage(0);

  // page 0 was evicted by pages 2 and 3, so it had to be read twice.
  assert.deepEqual(source.calls, [
    [0, 50],
    [50, 100],
    [100, 150],
    [150, 200],
    [0, 50],
  ]);
});

test("cancellation: a superseded showPage resolves stale and leaves the current page alone", async () => {
  const source = makeSource(300, { delay: 5 });
  const session = new ParquetSession(source);

  const slow = session.showPage(1);
  const fast = session.showPage(2);
  const [slowResult, fastResult] = await Promise.all([slow, fast]);

  assert.equal(slowResult.stale, true, "the earlier load must be marked stale");
  assert.deepEqual(slowResult.rows, []);
  assert.equal(fastResult.stale, false);
  assert.equal(session.page, 2);
  assert.equal(session.rows[0].id, 100);
});

test("reset: a prefetch from the previous file never lands in the new cache", async () => {
  // Regression for the old component: the visible-page load was sequence-guarded but the
  // prefetch write was not, so a reload could serve old rows from the new cache.
  const source = makeSource(300, { delay: 5 });
  const session = new ParquetSession(source);

  session.prefetch(1);
  session.reset();
  await new Promise((resolve) => setTimeout(resolve, 20));

  await session.showPage(1);
  const pageOneReads = source.calls.filter(([start]) => start === 50).length;
  assert.equal(pageOneReads, 2, "the post-reset read must hit the source again");
});

test("prefetch: warms the next page so showing it costs no read", async () => {
  const source = makeSource(300);
  const session = new ParquetSession(source);

  await session.showPage(0);
  session.prefetch(1);
  await new Promise((resolve) => setTimeout(resolve, 10));

  await session.showPage(1);
  assert.deepEqual(source.calls, [
    [0, 50],
    [50, 100],
  ]);
});

test("prefetch: concurrent duplicate requests share one read", async () => {
  const source = makeSource(300, { delay: 5 });
  const session = new ParquetSession(source);

  session.prefetch(1);
  session.prefetch(1);
  session.prefetch(1);
  await new Promise((resolve) => setTimeout(resolve, 30));

  assert.equal(source.calls.filter(([start]) => start === 50).length, 1);
});
