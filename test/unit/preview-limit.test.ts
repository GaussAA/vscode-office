import assert from "node:assert/strict";
import test from "node:test";
import {
  SPREADSHEET_PREVIEW_LIMITS,
  formatBytes,
  isOverPreviewLimit,
  previewLimitBytes,
  spreadsheetKind,
} from "@/common/previewLimit";

/**
 * One number, two ends: the host uses it to decide whether to read a virtual document at all,
 * the webview uses it to decide whether to parse a local one. The failure it prevents is a
 * 1.4 GB renderer tab (measured on a 152 MB CSV), so the boundary cases are worth pinning.
 */

test("limit: csv/tsv are text, workbooks are the expensive kind", () => {
  assert.equal(spreadsheetKind(".csv"), "text");
  assert.equal(spreadsheetKind(".TSV"), "text");
  assert.equal(spreadsheetKind(".xlsx"), "workbook");
  assert.equal(spreadsheetKind(".ods"), "workbook");
  assert.equal(spreadsheetKind(".xlsm"), "workbook");
});

test("limit: anything that is not a spreadsheet is not gated here", () => {
  assert.equal(spreadsheetKind(".parquet"), null);
  assert.equal(spreadsheetKind(undefined), null);
  assert.equal(previewLimitBytes(".jsonl"), Number.POSITIVE_INFINITY);
  assert.equal(isOverPreviewLimit(".jsonl", 500 * 1024 * 1024), false);
});

test("limit: the boundary belongs to the allowed side", () => {
  const limit = SPREADSHEET_PREVIEW_LIMITS.text;
  assert.equal(isOverPreviewLimit(".csv", limit), false);
  assert.equal(isOverPreviewLimit(".csv", limit + 1), true);
});

test("limit: an unknown size is never over the limit", () => {
  // `workspace.fs.stat` can fail for a scheme that does not implement it; refusing to open
  // a file because we could not measure it would be worse than trying.
  assert.equal(isOverPreviewLimit(".csv", undefined), false);
  assert.equal(isOverPreviewLimit(".csv", null), false);
  assert.equal(isOverPreviewLimit(".csv", 0), false);
});

test("limit: workbooks are held to a smaller size than text", () => {
  assert.ok(SPREADSHEET_PREVIEW_LIMITS.workbook < SPREADSHEET_PREVIEW_LIMITS.text);
  const over = SPREADSHEET_PREVIEW_LIMITS.workbook + 1;
  assert.equal(isOverPreviewLimit(".xlsx", over), true);
  assert.equal(isOverPreviewLimit(".csv", over), false);
});

test("formatBytes: readable at both ends of the range", () => {
  assert.equal(formatBytes(512), "1 KB");
  assert.equal(formatBytes(1536), "2 KB");
  assert.equal(formatBytes(15 * 1024 * 1024), "15.0 MB");
  assert.equal(formatBytes(152 * 1024 * 1024), "152.0 MB");
  assert.equal(formatBytes(0), "0 MB");
  assert.equal(formatBytes(undefined), "0 MB");
});
