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
  const session = new ParquetSession(source, { chunkSize: 50 });

  await session.showPage(0);
  await session.showPage(1);
  await session.showPage(0);

  assert.deepEqual(source.calls, [
    [0, 50],
    [50, 100],
  ]);
});

test("cache: bounded to maxCachedChunks", async () => {
  const source = makeSource(500);
  const session = new ParquetSession(source, { chunkSize: 50, maxCachedChunks: 2 });

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
  const session = new ParquetSession(source, { chunkSize: 50 });

  session.prefetch(1);
  session.reset();
  await new Promise((resolve) => setTimeout(resolve, 20));

  await session.showPage(1);
  const pageOneReads = source.calls.filter(([start]) => start === 50).length;
  assert.equal(pageOneReads, 2, "the post-reset read must hit the source again");
});

test("prefetch: warms the next page so showing it costs no read", async () => {
  const source = makeSource(300);
  const session = new ParquetSession(source, { chunkSize: 50 });

  await session.showPage(0);
  session.prefetch(1);
  await new Promise((resolve) => setTimeout(resolve, 10));

  const before = source.calls.length;
  await session.showPage(1);
  assert.equal(source.calls.length, before, "the prefetched page must cost no read");
  assert.ok(
    source.calls.some(([start]) => start === 50),
    "the prefetch must have read the page's rows",
  );
});

test("prefetch: concurrent duplicate requests share one read", async () => {
  const source = makeSource(300, { delay: 5 });
  const session = new ParquetSession(source, { chunkSize: 50 });

  session.prefetch(1);
  session.prefetch(1);
  session.prefetch(1);
  await new Promise((resolve) => setTimeout(resolve, 30));

  assert.equal(source.calls.filter(([start]) => start === 50).length, 1);
});

test("chunks: turning pages inside a chunk reads once", async () => {
  // A parquet data page costs the same for 50 rows as for 20,000: measured on a 202 MB file,
  // both read 22.6 MB and took ~1.4 s. Pages of one chunk must therefore share one read.
  const source = makeSource(300);
  const session = new ParquetSession(source, { pageSize: 50, chunkSize: 200 });

  for (const page of [0, 1, 2, 3]) await session.showPage(page);
  assert.deepEqual(source.calls, [[0, 200]], "four pages inside one chunk cost one read");

  await session.showPage(4);
  assert.deepEqual(source.calls, [
    [0, 200],
    [200, 300],
  ]);
});

test("chunks: a page is still a page", async () => {
  const session = new ParquetSession(makeSource(300), { pageSize: 50, chunkSize: 200 });
  const third = await session.showPage(2);
  assert.deepEqual([third.start, third.end, third.rows.length], [100, 150, 50]);
  assert.equal(third.rows[0].id, 100, "the slice must line up with the page, not the chunk");
});

test("chunks: prefetch reads the next chunk once the current one is warm", async () => {
  const source = makeSource(300);
  const session = new ParquetSession(source, { pageSize: 50, chunkSize: 100 });

  await session.showPage(0); // chunk 0 in memory
  session.prefetch(1);
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.deepEqual(source.calls, [
    [0, 100],
    [100, 200],
  ]);
  await session.showPage(2); // first page of chunk 1
  assert.equal(source.calls.length, 2, "crossing the boundary was already warmed");
});

test("page size: re-paging keeps the chunks and lands on the row you were reading", async () => {
  const source = makeSource(5_000);
  const session = new ParquetSession(source, { pageSize: 50, chunkSize: 5_000 });
  await session.showPage(2); // rows 100..150

  const page = session.setPageSize(20, 120);
  assert.equal(session.pageSize, 20);
  assert.equal(page, 6, "row 120 is on page 6 of 20-row pages");
  assert.equal(session.totalPages, 250, "a page is one screenful, so the count follows it");
  assert.deepEqual(source.calls, [[0, 5_000]], "re-paging must not read again");

  const snapshot = await session.showPage(page);
  assert.deepEqual([snapshot.start, snapshot.end], [120, 140]);
  assert.equal(snapshot.rows[0].id, 120);
});

test("page size: a load sliced with the old size is discarded", async () => {
  const source = makeSource(300, { delay: 5 });
  const session = new ParquetSession(source, { pageSize: 50, chunkSize: 300 });
  const inFlight = session.showPage(0);
  session.setPageSize(20, 0);
  const stale = await inFlight;
  assert.equal(stale.stale, true, "the old slice must not land on the new page grid");
});

test("restore: restoreToRow sets isRestorePending", () => {
  const session = new ParquetSession(makeSource(300), { pageSize: 50 });
  assert.equal(session.isRestorePending, false);
  session.restoreToRow(120);
  assert.equal(session.isRestorePending, true);
});

test("restore: clearRestore clears the restore state", () => {
  const session = new ParquetSession(makeSource(300), { pageSize: 50 });
  session.restoreToRow(120);
  assert.equal(session.isRestorePending, true);
  session.clearRestore();
  assert.equal(session.isRestorePending, false);
});

test("restore: setPageSize with restore pending returns the restore row's page", () => {
  const session = new ParquetSession(makeSource(5_000), { pageSize: 50 });
  session.restoreToRow(120);
  const page = session.setPageSize(20);
  assert.equal(page, 6, "row 120 is on page 6 of 20-row pages");
  assert.equal(session.isRestorePending, false, "setPageSize must clear restore pending");
});

test("restore: setPageSize with keepRow ignores restore pending", () => {
  const session = new ParquetSession(makeSource(5_000), { pageSize: 50 });
  session.restoreToRow(120);
  const page = session.setPageSize(20, 200);
  assert.equal(page, 10, "row 200 is on page 10 of 20-row pages");
  assert.equal(session.isRestorePending, true, "keepRow must not clear restore pending");
});

test("restore: showPage clears restore pending when it loads the restore row's page", async () => {
  const session = new ParquetSession(makeSource(300), { pageSize: 50 });
  session.restoreToRow(100);
  assert.equal(session.isRestorePending, true);
  await session.showPage(2); // page 2 starts at row 100
  assert.equal(
    session.isRestorePending,
    false,
    "loading the restore row's page must clear pending",
  );
});

test("restore: showPage does not clear restore pending for a different page", async () => {
  const session = new ParquetSession(makeSource(300), { pageSize: 50 });
  session.restoreToRow(100);
  await session.showPage(0); // page 0 starts at row 0
  assert.equal(session.isRestorePending, true, "loading a different page must not clear pending");
});

test("restore: restoreToRow(0) is treated as row 0, not as no restore", () => {
  const session = new ParquetSession(makeSource(300), { pageSize: 50 });
  session.restoreToRow(0);
  assert.equal(session.isRestorePending, true);
  const page = session.setPageSize(20);
  assert.equal(page, 0, "row 0 is on page 0");
  assert.equal(session.isRestorePending, false);
});

test("page size: a resize without keepRow stays on the row that was on screen", async () => {
  // Regression: the new size used to be assigned before `startOf(currentPage)` was read, so
  // page 2 of 50 became "row 40" of a 20-row grid and the reader jumped back 60 rows.
  const session = new ParquetSession(makeSource(5_000), { pageSize: 50, chunkSize: 5_000 });
  await session.showPage(2); // rows 100..150
  const page = session.setPageSize(20);
  assert.equal(page, 5, "row 100 is on page 5 of 20-row pages");
  assert.equal(session.pageToRow(page), 100);
});

test("fitPageSize: same size and nothing pending is a no-op", () => {
  const session = new ParquetSession(makeSource(300), { pageSize: 20 });
  assert.equal(session.fitPageSize(20), null, "no page change, so no reload");
  assert.equal(session.fitPageSize(20.9), null, "the size is normalised before it is compared");
});

test("fitPageSize: a pending restore is applied even when the size already matches", () => {
  // Regression: the view compared the measured size with its own copy of it. A session created
  // in a viewer that already knew its size matched, so the restore row was never turned into a
  // page and the document opened on page 0.
  const session = new ParquetSession(makeSource(300), { pageSize: 21 });
  session.restoreToRow(63);
  const page = session.fitPageSize(21);
  assert.equal(page, 3, "row 63 is on page 3 of 21-row pages");
  assert.equal(session.isRestorePending, false, "the first measurement consumes the restore");
  assert.equal(session.fitPageSize(21), null, "and a second identical measurement does nothing");
});

test("fitPageSize: a changed size without a restore keeps the loaded row", async () => {
  const session = new ParquetSession(makeSource(300), { pageSize: 50 });
  await session.showPage(1); // rows 50..100
  assert.equal(session.fitPageSize(25), 2, "row 50 is on page 2 of 25-row pages");
  assert.equal(session.pageSize, 25);
});

test("fitPageSize: a load started before the restore was applied cannot land", async () => {
  // The viewer starts the page-0 load in the same commit that measures the table. The measurement
  // changes the size, so that load must come back stale instead of replacing the restored page.
  const session = new ParquetSession(makeSource(300, { delay: 5 }), { pageSize: 8 });
  session.restoreToRow(100);
  const early = session.showPage(0);
  const page = session.fitPageSize(20);
  const stale = await early;
  assert.equal(stale.stale, true);
  const restored = await session.showPage(page ?? 0);
  assert.equal(restored.start, 100);
  assert.equal(restored.rows[0].id, 100);
});

test("paging: snapshot carries pageSize and totalPages and is immutable", () => {
  const session = new ParquetSession(makeSource(120), { pageSize: 50 });
  const paging = session.paging;
  assert.deepEqual({ ...paging }, { pageSize: 50, totalPages: 3 });
  assert.equal(
    Object.isFrozen(paging),
    true,
    "a view must not be able to edit the session's numbers",
  );
});

test("paging: the snapshot keeps its identity until the page size changes", () => {
  // A view stores `session.paging` in one useState after every measurement. Same object means
  // React bails out, so an unchanged measurement must not cost a render.
  const session = new ParquetSession(makeSource(300), { pageSize: 50 });
  const before = session.paging;
  assert.equal(session.fitPageSize(50), null);
  assert.equal(session.setPageSize(50), 0);
  assert.equal(session.paging, before, "setting the same size keeps the same snapshot");

  session.setPageSize(20);
  assert.notEqual(session.paging, before, "a new size produces a new snapshot");
  assert.deepEqual({ ...session.paging }, { pageSize: 20, totalPages: 15 });
  assert.equal(before.pageSize, 50, "the old snapshot is not mutated");
});

test("paging: the snapshot follows fitPageSize, including the normalised size", () => {
  const session = new ParquetSession(makeSource(5_000), { pageSize: 50, chunkSize: 100 });
  session.fitPageSize(40.9);
  assert.deepEqual({ ...session.paging }, { pageSize: 40, totalPages: 125 });
  session.fitPageSize(10_000);
  assert.deepEqual(
    { ...session.paging },
    { pageSize: 100, totalPages: 50 },
    "clamped to the chunk",
  );
});

test("paging: an empty file still has one page", () => {
  const session = new ParquetSession(makeSource(0), { pageSize: 50 });
  assert.deepEqual({ ...session.paging }, { pageSize: 50, totalPages: 1 });
  assert.equal(session.rowToPage(0), 0);
  assert.equal(session.endOf(0), 0);
});

test("endOf: a full page ends one page size after its start", () => {
  const session = new ParquetSession(makeSource(120), { pageSize: 50 });
  assert.equal(session.endOf(0), 50);
  assert.equal(session.endOf(1), 100);
});

test("endOf: the last page is cut short at the row count", () => {
  const session = new ParquetSession(makeSource(120), { pageSize: 50 });
  assert.equal(session.endOf(2), 120);
});

test("endOf: follows a page size change and agrees with showPage", async () => {
  const session = new ParquetSession(makeSource(300), { pageSize: 50, chunkSize: 300 });
  session.setPageSize(20, 0);
  assert.equal(session.endOf(3), 80);
  const snapshot = await session.showPage(3);
  assert.deepEqual([snapshot.start, snapshot.end], [session.pageToRow(3), session.endOf(3)]);
});

test("rowToPage and pageToRow: round trip on every page start, before and after a resize", () => {
  const session = new ParquetSession(makeSource(1_000), { pageSize: 50, chunkSize: 1_000 });
  for (const size of [50, 21, 8]) {
    session.setPageSize(size, 0);
    for (let page = 0; page < session.totalPages; page++) {
      assert.equal(session.rowToPage(session.pageToRow(page)), page, `size ${size}, page ${page}`);
    }
  }
});

test("rowToPage: every row of a page maps back to that page", () => {
  const session = new ParquetSession(makeSource(300), { pageSize: 21 });
  const page = 4;
  for (let row = session.pageToRow(page); row < session.endOf(page); row++) {
    assert.equal(session.rowToPage(row), page, `row ${row}`);
  }
  assert.equal(session.rowToPage(session.endOf(page)), page + 1);
});

test("totalPages: rounds up and agrees with the page holding the last row", () => {
  const session = new ParquetSession(makeSource(101), { pageSize: 50 });
  assert.equal(session.totalPages, 3);
  assert.equal(session.rowToPage(100), session.totalPages - 1);
  session.setPageSize(101, 0);
  assert.equal(session.totalPages, 1);
  session.setPageSize(100, 0);
  assert.equal(session.totalPages, 2);
});

test("setPageSize: the returned page is computed with the new size and clamped", () => {
  const session = new ParquetSession(makeSource(100), { pageSize: 10 });
  assert.equal(session.setPageSize(30, 99), 3, "row 99 is on page 3 of 30-row pages");
  assert.equal(session.setPageSize(30, 5_000), 3, "a row past the end lands on the last page");
  assert.equal(session.setPageSize(30, -5), 0, "a negative row lands on the first page");
});
