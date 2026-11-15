import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  bookTypeFor,
  kindOf,
  LEGACY_FORMATS,
  limitFor,
  SHEET_EXTENSIONS,
  viewFor,
  type SheetExtension,
} from "../../src/react/view/excel/sheetKind";
import { SPREADSHEET_PREVIEW_LIMITS } from "../../src/common/previewLimit";

void describe("sheetKind", () => {
  test("kindOf: normalizes and validates extensions", () => {
    assert.equal(kindOf(".xlsx"), ".xlsx");
    assert.equal(kindOf(".XLSX"), ".xlsx");
    assert.equal(kindOf(".XlSx"), ".xlsx");
    assert.equal(kindOf(".csv"), ".csv");
    assert.equal(kindOf(".tsv"), ".tsv");
    assert.equal(kindOf(".xls"), ".xls");
    assert.equal(kindOf(".ods"), ".ods");
    assert.equal(kindOf(".xlsm"), ".xlsm");

    assert.equal(kindOf(".parquet"), null);
    assert.equal(kindOf(".docx"), null);
    assert.equal(kindOf(""), null);
    assert.equal(kindOf(".unknown"), null);
  });

  test("viewFor: maps extensions to the correct view", () => {
    // Text formats → spreadsheet (editable grid)
    assert.equal(viewFor(".csv"), "spreadsheet");
    assert.equal(viewFor(".tsv"), "spreadsheet");

    // Workbook formats → windowed (read-only)
    assert.equal(viewFor(".xlsx"), "windowed");
    assert.equal(viewFor(".xlsm"), "windowed");
    assert.equal(viewFor(".xls"), "windowed");
    assert.equal(viewFor(".ods"), "windowed");
  });

  test("limitFor: returns correct size limits", () => {
    // Text formats: 25 MB
    assert.equal(limitFor(".csv"), SPREADSHEET_PREVIEW_LIMITS.text);
    assert.equal(limitFor(".tsv"), SPREADSHEET_PREVIEW_LIMITS.text);
    assert.equal(limitFor(".csv"), 25 * 1024 * 1024);

    // Workbook formats: 15 MB
    assert.equal(limitFor(".xlsx"), SPREADSHEET_PREVIEW_LIMITS.workbook);
    assert.equal(limitFor(".xlsm"), SPREADSHEET_PREVIEW_LIMITS.workbook);
    assert.equal(limitFor(".xls"), SPREADSHEET_PREVIEW_LIMITS.workbook);
    assert.equal(limitFor(".ods"), SPREADSHEET_PREVIEW_LIMITS.workbook);
    assert.equal(limitFor(".xlsx"), 15 * 1024 * 1024);
  });

  test("bookTypeFor: returns correct SheetJS bookType", () => {
    assert.equal(bookTypeFor(".xlsx"), "xlsx");
    assert.equal(bookTypeFor(".xlsm"), "xlsm");
    assert.equal(bookTypeFor(".xls"), "xls");
    assert.equal(bookTypeFor(".ods"), "ods");
    assert.equal(bookTypeFor(".csv"), "csv");
    assert.equal(bookTypeFor(".tsv"), "txt");
  });

  test("bookTypeFor: .xls and .ods are not written as xlsx", () => {
    // This was the bug: before sheetKind, excel_writer.ts always used "xlsx"
    assert.notEqual(bookTypeFor(".xls"), "xlsx");
    assert.notEqual(bookTypeFor(".ods"), "xlsx");
  });

  test("SHEET_EXTENSIONS: contains all valid extensions", () => {
    const expected: SheetExtension[] = [".xlsx", ".xlsm", ".xls", ".ods", ".csv", ".tsv"];
    for (const ext of expected) {
      assert.ok(SHEET_EXTENSIONS.has(ext), `missing ${ext}`);
    }
    assert.equal(SHEET_EXTENSIONS.size, expected.length);
  });

  test("LEGACY_FORMATS: contains .xls and .ods", () => {
    assert.ok(LEGACY_FORMATS.has(".xls"));
    assert.ok(LEGACY_FORMATS.has(".ods"));
    assert.equal(LEGACY_FORMATS.size, 2);
  });
});
