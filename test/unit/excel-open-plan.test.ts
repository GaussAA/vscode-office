import { test } from "node:test";
import assert from "node:assert/strict";
import {
  excelWindowKind,
  excelWorkbookParser,
  planExcelOpen,
} from "../../src/react/view/excel/excelOpenPlan";

test("excel open plan: an oversized payload is guarded unless forced", () => {
  assert.equal(planExcelOpen({ forced: false, tooLarge: true, view: "grid" }), "guard");
  assert.equal(planExcelOpen({ forced: false, tooLarge: undefined, view: "refused" }), "guard");
  assert.equal(planExcelOpen({ forced: true, tooLarge: true, view: "refused" }), "load");
  assert.equal(planExcelOpen({ forced: false, tooLarge: false, view: "window" }), "load");
});

test("excel open plan: windowed payloads split into workbook and text", () => {
  assert.equal(excelWindowKind(".xlsx"), "workbook");
  assert.equal(excelWindowKind(".xlsm"), "workbook");
  assert.equal(excelWindowKind(".ods"), "workbook");
  assert.equal(excelWindowKind(".csv"), "text");
  assert.equal(excelWindowKind(".tsv"), "text");
});

test("excel open plan: legacy containers use SheetJS; xlsx/xlsm use ExcelJS", () => {
  assert.equal(excelWorkbookParser(".xls"), "legacy");
  assert.equal(excelWorkbookParser(".ods"), "legacy");
  assert.equal(excelWorkbookParser(".xlsx"), "exceljs");
  assert.equal(excelWorkbookParser(".xlsm"), "exceljs");
});
