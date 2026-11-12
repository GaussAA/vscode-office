import { test } from "node:test";
import assert from "node:assert/strict";
import { computeParquetColumnLayout } from "../../src/react/view/parquet/parquetColumnLayout";
import { INDEX_COLUMN_WIDTH } from "../../src/react/view/parquet/parquetLayout";

test("parquet column layout: no columns still accounts for the index column", () => {
  const layout = computeParquetColumnLayout([], 1000);
  assert.deepEqual(layout, { widths: [], filler: 0, extent: INDEX_COLUMN_WIDTH });
});

test("parquet column layout: a narrow viewport keeps every width untouched", () => {
  const layout = computeParquetColumnLayout([100, 120, 140], 300);
  assert.deepEqual(layout.widths, [100, 120, 140]);
  assert.equal(layout.filler, 0);
  assert.equal(layout.extent, INDEX_COLUMN_WIDTH + 360);
});

test("parquet column layout: spare room grows columns uniformly and leaves a filler", () => {
  const layout = computeParquetColumnLayout([100, 100], 700);
  assert.deepEqual(layout.widths, [240, 240]);
  assert.equal(layout.extent, INDEX_COLUMN_WIDTH + 480);
  assert.equal(layout.filler, 700 - INDEX_COLUMN_WIDTH - 480);
});

test("parquet column layout: growth stops at the stretch cap", () => {
  const layout = computeParquetColumnLayout([100, 100], 1200);
  assert.deepEqual(layout.widths, [240, 240]);
  assert.equal(layout.filler, 1200 - INDEX_COLUMN_WIDTH - 480);
});

test("parquet column layout: columns already at the cap still get a filler for the leftover", () => {
  const layout = computeParquetColumnLayout([240, 240], 1200);
  assert.deepEqual(layout.widths, [240, 240]);
  assert.equal(layout.extent, INDEX_COLUMN_WIDTH + 480);
  assert.equal(layout.filler, 1200 - INDEX_COLUMN_WIDTH - 480);
});
