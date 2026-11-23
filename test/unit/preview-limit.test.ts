import assert from "node:assert/strict";
import test from "node:test";
import {
  PARQUET_PREVIEW_LIMIT,
  formatBytes,
  isOverPreviewLimit,
  previewLimitBytes,
} from "@/common/previewLimit";

/**
 * One number, two ends: the host uses it to decide whether to read a virtual document at all,
 * the webview uses it to decide whether to parse a local one. The failure it prevents is a
 * renderer tab that dies holding a whole file on the JSON bridge, so the boundary cases and
 * the "a format nobody staged is never refused" rule are worth pinning.
 */

test("limit: parquet is the only gated format", () => {
  assert.equal(previewLimitBytes(".parquet"), PARQUET_PREVIEW_LIMIT);
  assert.equal(previewLimitBytes(".PARQUET"), PARQUET_PREVIEW_LIMIT);
});

test("limit: a format the gate does not know is never refused", () => {
  assert.equal(previewLimitBytes(".jsonl"), Number.POSITIVE_INFINITY);
  assert.equal(previewLimitBytes(".ndjson"), Number.POSITIVE_INFINITY);
  assert.equal(previewLimitBytes(undefined), Number.POSITIVE_INFINITY);
  assert.equal(isOverPreviewLimit(".jsonl", 500 * 1024 * 1024), false);
});

test("limit: the boundary belongs to the allowed side", () => {
  assert.equal(isOverPreviewLimit(".parquet", PARQUET_PREVIEW_LIMIT), false);
  assert.equal(isOverPreviewLimit(".parquet", PARQUET_PREVIEW_LIMIT + 1), true);
});

test("limit: an unknown size is never over the limit", () => {
  // `workspace.fs.stat` can fail for a scheme that does not implement it; refusing to open
  // a file because we could not measure it would be worse than trying.
  assert.equal(isOverPreviewLimit(".parquet", undefined), false);
  assert.equal(isOverPreviewLimit(".parquet", null), false);
  assert.equal(isOverPreviewLimit(".parquet", 0), false);
});

test("formatBytes: readable at both ends of the range", () => {
  assert.equal(formatBytes(512), "1 KB");
  assert.equal(formatBytes(1536), "2 KB");
  assert.equal(formatBytes(15 * 1024 * 1024), "15.0 MB");
  assert.equal(formatBytes(152 * 1024 * 1024), "152.0 MB");
  assert.equal(formatBytes(0), "0 MB");
  assert.equal(formatBytes(undefined), "0 MB");
});
