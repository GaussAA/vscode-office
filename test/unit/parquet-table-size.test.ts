import { test } from "node:test";
import assert from "node:assert/strict";
import { pageSizeForBodyHeight } from "../../src/react/view/parquet/useParquetTableSize";
import {
  MIN_ROWS_PER_PAGE,
  PARQUET_MAX_PAGE_SIZE,
  ROW_HEIGHT,
} from "../../src/react/view/parquet/parquetLayout";

test("parquet page size: follows the visible body height", () => {
  assert.equal(pageSizeForBodyHeight(320), Math.floor(320 / 34));
  assert.equal(pageSizeForBodyHeight(PARQUET_MAX_PAGE_SIZE * ROW_HEIGHT), PARQUET_MAX_PAGE_SIZE);
});

test("parquet page size: never drops below the minimum or exceeds the cap", () => {
  assert.equal(pageSizeForBodyHeight(0), MIN_ROWS_PER_PAGE);
  assert.equal(pageSizeForBodyHeight(-100), MIN_ROWS_PER_PAGE);
  assert.equal(pageSizeForBodyHeight(PARQUET_MAX_PAGE_SIZE * 34 * 10), PARQUET_MAX_PAGE_SIZE);
});
