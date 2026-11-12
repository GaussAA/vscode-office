import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  bodyRowToFileRow,
  cellId,
  clampColumnWidth,
  columnName,
  fileRowToBodyRow,
  gridTemplateFor,
  toBodySource,
} from "@/react/view/excel/windowedSheetModel";
import type { SheetSource } from "@/react/view/excel/sheetSource";

test("column widths clamp to the resize range", () => {
  assert.equal(clampColumnWidth(10), MIN_COLUMN_WIDTH);
  assert.equal(clampColumnWidth(MAX_COLUMN_WIDTH + 1), MAX_COLUMN_WIDTH);
  assert.equal(clampColumnWidth(199.6), 200);
});

test("grid template keeps auto columns fluid and puts fixed widths first", () => {
  assert.equal(gridTemplateFor({}, 2), "56px minmax(140px, 1fr) minmax(140px, 1fr)");
  assert.equal(gridTemplateFor({ 0: 220 }, 2), "56px 220px minmax(140px, 1fr)");
});

test("file and body row coordinates preserve the frozen header", () => {
  assert.equal(fileRowToBodyRow(1, 5_001), 0);
  assert.equal(fileRowToBodyRow(2, 5_001), 0);
  assert.equal(fileRowToBodyRow(3, 5_001), 1);
  assert.equal(fileRowToBodyRow(5_001, 5_001), 4_999);
  assert.equal(fileRowToBodyRow(9_999, 5_001), 4_999);
  assert.equal(fileRowToBodyRow(1, 1), 0);
  assert.equal(bodyRowToFileRow(0), 2);
  assert.equal(bodyRowToFileRow(4_999), 5_001);
});

test("cell ids and column labels stay stable", () => {
  assert.equal(cellId(2, 4), "windowed-sheet-cell-2-4");
  assert.equal(columnName(0), "A");
  assert.equal(columnName(25), "Z");
  assert.equal(columnName(26), "AA");
});

test("toBodySource removes only the header and offsets reads", async () => {
  const source: SheetSource = {
    kind: "text",
    rowCount: 4,
    columnCount: 2,
    async readRows(start, end) {
      return Array.from({ length: end - start }, (_, offset) => [`r${start + offset}`, "x"]);
    },
  };
  const body = toBodySource(source);
  assert.equal(body.rowCount, 3);
  assert.deepEqual(await body.readRows(0, 2), [
    ["r1", "x"],
    ["r2", "x"],
  ]);
  assert.deepEqual(await source.readRows(0, 1), [["r0", "x"]]);
});
