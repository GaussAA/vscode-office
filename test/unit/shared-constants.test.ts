/**
 * Cross-check that JSON and JSONL constants derive from shared recordConstants.
 */
import { strict as assert } from "node:assert";
import test from "node:test";
import {
  JSON_MAX_TEXT_CHARS,
  JSON_RAW_PREVIEW_CHARS,
  JSON_RECORD_MAX_BYTES,
  JSON_SEARCH_BATCH,
  JSON_SEARCH_MAX_MATCHES,
} from "@/common/jsonPreviewTypes";
import {
  JSONL_MAX_LINE_BYTES,
  JSONL_MAX_TEXT_CHARS,
  JSONL_RAW_PREVIEW_CHARS,
  JSONL_SEARCH_BATCH,
  JSONL_SEARCH_MAX_MATCHES,
} from "@/common/jsonlTypes";

test("JSON and JSONL record limits are equal (both derive from RECORD_MAX_BYTES)", () => {
  assert.equal(
    JSON_RECORD_MAX_BYTES,
    JSONL_MAX_LINE_BYTES,
    "JSON record max and JSONL line max must be the same shared value",
  );
  assert.equal(JSON_RECORD_MAX_BYTES, 8 * 1024 * 1024, "Expected 8MB record limit");
});

test("JSON and JSONL text char limits are equal", () => {
  assert.equal(
    JSON_MAX_TEXT_CHARS,
    JSONL_MAX_TEXT_CHARS,
    "Both formats should use the same max text characters",
  );
  assert.equal(JSON_MAX_TEXT_CHARS, 1_000_000, "Expected 1M char limit");
});

test("JSON and JSONL raw preview lengths are equal", () => {
  assert.equal(
    JSON_RAW_PREVIEW_CHARS,
    JSONL_RAW_PREVIEW_CHARS,
    "Both formats should use the same raw preview length",
  );
  assert.equal(JSON_RAW_PREVIEW_CHARS, 400, "Expected 400-char preview");
});

test("JSON and JSONL search batch sizes are equal", () => {
  assert.equal(
    JSON_SEARCH_BATCH,
    JSONL_SEARCH_BATCH,
    "Both formats should use the same search batch size",
  );
  assert.equal(JSON_SEARCH_BATCH, 200, "Expected batch size of 200");
});

test("JSON and JSONL search max matches are equal", () => {
  assert.equal(
    JSON_SEARCH_MAX_MATCHES,
    JSONL_SEARCH_MAX_MATCHES,
    "Both formats should use the same max matches limit",
  );
  assert.equal(JSON_SEARCH_MAX_MATCHES, 10_000, "Expected 10k matches cap");
});
