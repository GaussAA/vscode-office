import assert from "node:assert/strict";
import test from "node:test";
import type { SheetSource } from "@/react/view/excel/sheetSource";
import { nextMatch, searchSheetRows } from "@/react/view/excel/sheetSearch";

/**
 * Phase 3 of ADR-0017: the windowed view has no cell model to walk, so find scans row blocks
 * from the source. What can go wrong is a shifted row index (one block's offset forgotten) or a
 * scan that cannot be stopped — both are pinned here.
 */

function sourceWith(rows: string[][], columnCount = 2) {
  const calls: Array<[number, number]> = [];
  const source: SheetSource = {
    kind: "text",
    rowCount: rows.length,
    columnCount,
    async readRows(start, end) {
      calls.push([start, end]);
      return rows.slice(start, end);
    },
  };
  return { source, calls };
}

function sheet(rowCount: number) {
  const rows: string[][] = [["id", "name"]];
  for (let index = 0; index < rowCount - 1; index++) rows.push([String(index), `row-${index}`]);
  return rows;
}

test("search: finds a row by any of its cells, case-insensitively", async () => {
  const { source } = sourceWith(sheet(10));

  const result = await searchSheetRows(source, "ROW-4");

  assert.deepEqual(result.rows, [5], "row index includes the header row");
  assert.equal(result.scanned, 10);
});

test("search: block boundaries do not shift the reported row index", async () => {
  const { source } = sourceWith(sheet(5000));

  const result = await searchSheetRows(source, "row-4097", { batchRows: 1024 });

  assert.deepEqual(result.rows, [4098]);
});

test("search: stops at the cap and says so", async () => {
  const { source, calls } = sourceWith(sheet(5000));

  const result = await searchSheetRows(source, "row-", { maxRows: 3, batchRows: 100 });

  assert.equal(result.rows.length, 3);
  assert.equal(result.capped, true);
  assert.ok(calls.length < 10, "a capped search must stop early, not scan the file");
});

test("search: cancellation stops between blocks and keeps what it found", async () => {
  let read = 0;
  const rows = sheet(5000);
  const source: SheetSource = {
    kind: "text",
    rowCount: rows.length,
    columnCount: 2,
    async readRows(start, end) {
      read++;
      return rows.slice(start, end);
    },
  };

  const result = await searchSheetRows(source, "row-1", {
    batchRows: 100,
    isCancelled: () => read >= 2,
  });

  assert.equal(result.cancelled, true);
  assert.ok(result.scanned < rows.length, "the scan must not run to the end");
});

test("search: an empty query scans nothing", async () => {
  const { source, calls } = sourceWith(sheet(10));

  const result = await searchSheetRows(source, "   ");

  assert.deepEqual(result, { rows: [], capped: false, cancelled: false, scanned: 0 });
  assert.equal(calls.length, 0);
});

test("search: progress ends on the row count and the match count", async () => {
  const { source } = sourceWith(sheet(1000));
  const samples: Array<[number, number]> = [];

  await searchSheetRows(source, "row-7", {
    batchRows: 128,
    onProgress: (scanned, matches) => samples.push([scanned, matches]),
  });

  const last = samples[samples.length - 1];
  assert.equal(last[0], 1000);
  assert.ok(last[1] > 0);
});

test("nextMatch: forward wraps to the first, backward to the last", () => {
  const matches = [2, 10, 40];

  assert.equal(nextMatch(matches, 0, 1), 2);
  assert.equal(nextMatch(matches, 10, 1), 40);
  assert.equal(nextMatch(matches, 40, 1), 2, "forward wraps");
  assert.equal(nextMatch(matches, 40, -1), 10);
  assert.equal(nextMatch(matches, 2, -1), 40, "backward wraps");
  assert.equal(nextMatch([], 5, 1), undefined);
});
