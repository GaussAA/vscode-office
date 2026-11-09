import assert from "node:assert/strict";
import test from "node:test";
import { createWorkbookSheetSource } from "@/react/view/excel/workbookSource";

/**
 * Phase 4 of ADR-0017: a workbook is parsed whole (a zip cannot be seeked) but kept as row text
 * instead of one object per cell. This wrapper is what the windowed view reads, so its slicing
 * and sheet switching have to be exact — a shifted slice would show the wrong sheet.
 */

const sheets = [
  {
    name: "Data",
    rows: [
      ["id", "name"],
      ["1", "alpha"],
      ["2", "beta"],
    ],
  },
  { name: "Extra", rows: [["x"], ["y"]] },
];

test("workbook: rows, columns and window reads", async () => {
  const source = createWorkbookSheetSource(sheets);

  assert.equal(source.rowCount, 3);
  assert.equal(source.columnCount, 2);
  assert.deepEqual(await source.readRows(1, 3), [
    ["1", "alpha"],
    ["2", "beta"],
  ]);
  assert.deepEqual(await source.readRows(2, 99), [["2", "beta"]], "end clamps");
  assert.deepEqual(await source.readRows(9, 12), []);
});

test("workbook: the sheet picker swaps the slice, not the parsed rows", async () => {
  const source = createWorkbookSheetSource(sheets);
  const extra = source.selectSheet(1);

  assert.deepEqual(source.sheetNames, ["Data", "Extra"]);
  assert.equal(source.sheetIndex, 0);
  assert.equal(extra.sheetIndex, 1);
  assert.equal(extra.rowCount, 2);
  assert.deepEqual(await extra.readRows(0, 2), [["x"], ["y"]]);
});

test("workbook: an out-of-range sheet index clamps instead of throwing", () => {
  const source = createWorkbookSheetSource(sheets, 99);

  assert.equal(source.sheetIndex, 1);
  assert.equal(source.rowCount, 2);
});

test("workbook: an empty workbook is a valid, empty source", async () => {
  const source = createWorkbookSheetSource([]);

  assert.equal(source.rowCount, 0);
  assert.equal(source.columnCount, 1);
  assert.deepEqual(await source.readRows(0, 10), []);
  assert.deepEqual(source.sheetNames, []);
});
