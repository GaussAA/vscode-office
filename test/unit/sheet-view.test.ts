import assert from "node:assert/strict";
import test from "node:test";
import {
  WINDOW_THRESHOLD_BYTES,
  cellText,
  headerCells,
  isRefusedView,
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
  assert.equal(sheetViewFor(".xlsx", 12 * 1024 * 1024), "grid", "workbooks need phase 4");
});

test("view: a big text file gets the read-only window", () => {
  assert.equal(sheetViewFor(".csv", WINDOW_THRESHOLD_BYTES + 1), "window");
  assert.equal(sheetViewFor(".tsv", 20 * 1024 * 1024), "window");
  assert.equal(sheetViewFor(".CSV", 20 * 1024 * 1024), "window", "extension case is irrelevant");
});

test("view: over the guard the file is refused, not windowed", () => {
  const over = SPREADSHEET_PREVIEW_LIMITS.text + 1;
  assert.equal(sheetViewFor(".csv", over), "refused");
  assert.equal(isRefusedView(".csv", over), true);
  assert.equal(isRefusedView(".csv", 1024), false);
  assert.equal(sheetViewFor(".csv", undefined), "grid", "an unknown size is never refused");
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
