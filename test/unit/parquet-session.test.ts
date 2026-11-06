import assert from "node:assert/strict";
import test from "node:test";
import { ParquetSession } from "@/react/view/parquet/parquetSession";

/**
 * A fake row reader shaped like the real one: `readRows(start, end)` returns objects.
 * `calls` records every range so tests can prove the cache and prefetch actually work.
 */
function makeSource(
  rowCount: number,
  { readOnly = false, delay = 0 }: { readOnly?: boolean; delay?: number } = {},
) {
  const calls: Array<[number, number]> = [];
  return {
    rowCount,
    readOnly,
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

test("edits: a patch survives navigation and is re-applied on the way back", async () => {
  const source = makeSource(300);
  const session = new ParquetSession(source);

  await session.showPage(0);
  assert.equal(session.patch(0, "name", "edited"), true);
  assert.deepEqual([...session.editedCells], ["0:name"]);

  await session.showPage(1);
  await session.showPage(0);

  assert.equal(session.rows[0].name, "edited");
  assert.equal(session.editedCount, 1);
});

test("edits: a patch for a page that was never displayed still applies when it loads", async () => {
  const session = new ParquetSession(makeSource(300));
  await session.showPage(0);

  assert.equal(session.patch(75, "name", "later"), true);
  const page = await session.showPage(1);

  assert.equal(page.rows[25].name, "later");
});

test("edits: patching the same value twice is not a change", async () => {
  const session = new ParquetSession(makeSource(50));
  await session.showPage(0);

  assert.equal(session.patch(0, "name", "row-0"), false, "unchanged value must be rejected");
  assert.equal(session.patch(0, "name", "other"), true);
  assert.equal(session.patch(0, "name", "other"), false, "the same edit twice is still no change");
});

test("edits: out-of-range rows and read-only sessions reject patches", async () => {
  const session = new ParquetSession(makeSource(50));
  assert.equal(session.patch(-1, "name", "x"), false);
  assert.equal(session.patch(50, "name", "x"), false);

  const locked = new ParquetSession(makeSource(50, { readOnly: true }));
  assert.equal(locked.readOnly, true);
  assert.equal(locked.patch(0, "name", "x"), false);
});

test("readOnly: derived from the row limit, and largeFile says why", async () => {
  const small = new ParquetSession(makeSource(1000));
  assert.equal(small.readOnly, false);
  assert.equal(small.largeFile, false);

  const big = new ParquetSession(makeSource(200_001));
  assert.equal(big.readOnly, true);
  assert.equal(
    big.largeFile,
    true,
    'largeFile distinguishes "too big to edit" from "file is read-only"',
  );
});

test("edits: a patch on the visible page updates rows immediately", async () => {
  const session = new ParquetSession(makeSource(50));
  await session.showPage(0);

  session.patch(3, "name", "live");
  assert.equal(session.rows[3].name, "live", "no reload needed for the page on screen");
});

test("search: readRange applies edits so a scan sees what the table shows", async () => {
  const session = new ParquetSession(makeSource(120));
  await session.showPage(0);

  session.patch(60, "name", "needle");
  const rows = await session.readRange(0, 120);

  assert.equal(rows.length, 120);
  assert.equal(rows[60].name, "needle");
});

test("save: rowsForSave re-reads everything once and applies every patch", async () => {
  const source = makeSource(120);
  const session = new ParquetSession(source);

  await session.showPage(0);
  session.patch(1, "name", "a");
  session.patch(60, "name", "b");
  session.patch(119, "name", "c");

  const before = source.calls.length;
  const rows = await session.rowsForSave();

  assert.equal(rows.length, 120);
  assert.equal(rows[1].name, "a");
  assert.equal(rows[60].name, "b");
  assert.equal(rows[119].name, "c");
  assert.deepEqual(source.calls.at(-1), [0, 120], "save reads the whole file in one call");
  assert.equal(source.calls.length, before + 1);
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
