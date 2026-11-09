import assert from "node:assert/strict";
import test from "node:test";
import {
  TEXT_WINDOW_MAX_BYTES,
  WINDOW_THRESHOLD_BYTES,
  cellText,
  headerCells,
  limitForView,
  sheetViewFor,
} from "@/react/view/excel/sheetView";
import { SPREADSHEET_PREVIEW_LIMITS } from "@/common/previewLimit";

/**
 * The view switch is a product rule, not a detail: above it, a CSV is read-only. Pinning it
 * here keeps the viewer, the README and ADR-0017 from disagreeing.
 */

test("view: normal files keep the editable grid", () => {
  assert.equal(sheetViewFor(".csv", 1024), "grid");
  assert.equal(sheetViewFor(".csv", WINDOW_THRESHOLD_BYTES), "grid");
  assert.equal(sheetViewFor(".xlsx", 12 * 1024 * 1024), "window", "phase 4 windowed workbooks");
  assert.equal(sheetViewFor(".xls", 12 * 1024 * 1024), "grid", "legacy xls stays on SheetJS");
  assert.equal(sheetViewFor(".ods", 12 * 1024 * 1024), "grid", "ods stays on SheetJS");
});

test("view: a big text file gets the read-only window", () => {
  assert.equal(sheetViewFor(".csv", WINDOW_THRESHOLD_BYTES + 1), "window");
  assert.equal(sheetViewFor(".tsv", 20 * 1024 * 1024), "window");
  assert.equal(sheetViewFor(".CSV", 20 * 1024 * 1024), "window", "extension case is irrelevant");
});

test("view: a local text file is windowed well past the old guard", () => {
  // The windowed path pays for the file's bytes and one offset per row, not a cell object per
  // value, so 50 MB is a normal case and the old 25 MB refusal no longer applies locally.
  assert.equal(sheetViewFor(".csv", 50 * 1024 * 1024), "window");
  assert.equal(sheetViewFor(".csv", TEXT_WINDOW_MAX_BYTES - 1), "window");
  assert.equal(sheetViewFor(".csv", TEXT_WINDOW_MAX_BYTES + 1), "refused");
  assert.equal(limitForView(".csv"), TEXT_WINDOW_MAX_BYTES, "the panel must show this limit");
});

test("view: a virtual text file keeps the bridge guard", () => {
  const over = SPREADSHEET_PREVIEW_LIMITS.text + 1;
  assert.equal(sheetViewFor(".csv", over, { virtual: true }), "refused");
  assert.equal(sheetViewFor(".csv", 20 * 1024 * 1024, { virtual: true }), "window");
  assert.equal(limitForView(".csv", { virtual: true }), SPREADSHEET_PREVIEW_LIMITS.text);
  assert.equal(sheetViewFor(".csv", undefined), "grid", "an unknown size is never refused");
});

test("view: workbooks keep their own limit", () => {
  const over = SPREADSHEET_PREVIEW_LIMITS.workbook + 1;
  assert.equal(sheetViewFor(".xlsx", over), "refused");
  assert.equal(limitForView(".xlsx"), SPREADSHEET_PREVIEW_LIMITS.workbook);
});

test("view: what is not a text spreadsheet never takes the window", () => {
  assert.equal(sheetViewFor(".parquet", 20 * 1024 * 1024), "grid");
  assert.equal(sheetViewFor(".jsonl", 20 * 1024 * 1024), "grid");
});

test("cells: long text is cut instead of wrapping a fixed-height row", () => {
  assert.equal(cellText("short"), "short");
  assert.equal(cellText(undefined), "");
  assert.equal(cellText("x".repeat(500)).length, 201);
});

test("header: pads unnamed columns with their number", () => {
  assert.deepEqual(headerCells([["a", "b"]], 3), ["a", "b", "3"]);
  assert.deepEqual(headerCells([], 2), ["1", "2"]);
});
