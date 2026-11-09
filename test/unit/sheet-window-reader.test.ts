import assert from "node:assert/strict";
import test from "node:test";
import type { SheetSource } from "@/react/view/excel/sheetSource";
import { createSheetWindowReader } from "@/react/view/excel/sheetWindowReader";

/**
 * The reader sits between a scroll handler and the data source. Two failures matter: decoding
 * the same window on every pixel (slow but correct) and letting an older read land after a
 * newer one (wrong rows under the cursor). Both are pinned here with a fake source that counts.
 */

const viewport = { rowHeight: 24, viewportHeight: 240, totalRows: 1000, overscan: 4 };

function fakeSource(totalRows = 1000) {
  const calls: Array<[number, number]> = [];
  const source: SheetSource = {
    kind: "text",
    rowCount: totalRows,
    columnCount: 3,
    async readRows(start: number, end: number) {
      calls.push([start, end]);
      const rows: string[][] = [];
      for (let row = start; row < Math.min(end, totalRows); row++) {
        rows.push([String(row), `b${row}`, `c${row}`]);
      }
      return rows;
    },
  };
  return { source, calls };
}

test("reader: the first window is read once and reused across the same offset", async () => {
  const { source, calls } = fakeSource();
  const reader = createSheetWindowReader(source);

  const first = await reader.rowsFor(0, viewport);
  const second = await reader.rowsFor(1, viewport); // same visible range

  assert.equal(calls.length, 1, "one pixel of scrolling must not re-read the window");
  assert.equal(first.stale, false);
  // The visible range grows by a row as the fold moves; it is still served from the block.
  assert.equal(second.range.end, first.range.end + 1);
  assert.deepEqual(second.rows.slice(0, first.rows.length), first.rows);
  assert.equal(reader.peek(0, viewport)?.length, first.rows.length);
});

test("reader: scrolling into new rows reads exactly one new window", async () => {
  const { source, calls } = fakeSource();
  const reader = createSheetWindowReader(source);

  await reader.rowsFor(0, viewport);
  const moved = await reader.rowsFor(24 * 100, viewport);

  assert.equal(calls.length, 2);
  assert.equal(moved.rows[0][0], String(moved.range.start));
});

test("reader: a superseded result is marked stale and does not reach the caller", async () => {
  const { source } = fakeSource();
  // First read resolves late; the second (newer) one must win.
  let releaseSlow: () => void = () => {};
  const slow = new Promise<void>((resolve) => {
    releaseSlow = resolve;
  });
  let call = 0;
  const gated: SheetSource = {
    ...source,
    async readRows(start, end) {
      call++;
      if (call === 1) await slow;
      return source.readRows(start, end);
    },
  };
  const reader = createSheetWindowReader(gated);

  const first = reader.rowsFor(0, viewport);
  const second = reader.rowsFor(24 * 200, viewport);
  releaseSlow();
  const [older, newer] = await Promise.all([first, second]);

  assert.equal(older.stale, true, "the older read must be ignored");
  assert.deepEqual(older.rows, []);
  assert.equal(newer.stale, false);
  assert.ok(newer.rows.length > 0);
});

test("reader: a failed read rejects the current request and leaves the cache alone", async () => {
  const failing: SheetSource = {
    kind: "text",
    rowCount: 10,
    columnCount: 1,
    async readRows() {
      throw new Error("disk gone");
    },
  };
  const reader = createSheetWindowReader(failing);

  await assert.rejects(() => reader.rowsFor(0, { ...viewport, totalRows: 10 }), /disk gone/);
  assert.equal(reader.peek(0, { ...viewport, totalRows: 10 }), undefined);
});
