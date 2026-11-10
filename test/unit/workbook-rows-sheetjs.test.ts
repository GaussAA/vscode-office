import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";
import { workbookRowsFromSheetJs } from "@/react/view/excel/workbookRows";

/**
 * `.xls`/`.ods` go through SheetJS rather than ExcelJS, so their row extraction is a second
 * implementation of the same contract: one string per cell, formatted text, blank rows kept so
 * the sheet does not shift up. The windowed view of such a file is only correct if this holds.
 */

function workbookOf(rows: unknown[][], second: unknown[][] = [["z"]]) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "Data");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(second), "Other");
  return workbook;
}

test("sheetjs rows: every sheet, in order, as text", () => {
  const sheets = workbookRowsFromSheetJs(
    workbookOf([
      ["id", "name"],
      [1, "alpha"],
    ]),
  );

  assert.deepEqual(
    sheets.map((sheet) => sheet.name),
    ["Data", "Other"],
  );
  assert.deepEqual(sheets[0].rows, [
    ["id", "name"],
    ["1", "alpha"],
  ]);
});

test("sheetjs rows: blank rows are preserved, not collapsed", () => {
  const sheets = workbookRowsFromSheetJs(workbookOf([["a"], [], ["c"]]));

  assert.equal(sheets[0].rows.length, 3);
  assert.deepEqual(sheets[0].rows[1], [""]);
  assert.deepEqual(sheets[0].rows[2], ["c"]);
});

test("sheetjs rows: an empty worksheet is a sheet with no rows", () => {
  const sheets = workbookRowsFromSheetJs(workbookOf([]));

  assert.deepEqual(sheets[0], { name: "Data", rows: [] });
});

test("sheetjs rows: boolean cells become their display text", () => {
  const sheets = workbookRowsFromSheetJs(workbookOf([["ok"], [true], [false]]));

  assert.deepEqual(sheets[0].rows, [["ok"], ["TRUE"], ["FALSE"]]);
});
