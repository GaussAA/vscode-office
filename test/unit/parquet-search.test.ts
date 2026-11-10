import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parquetWriteBuffer } from "hyparquet-writer";
import { openParquetFile } from "@/react/view/parquet/parquetParser";
import { searchParquetValues } from "@/react/view/parquet/parquetSearch";

/**
 * The search used to read the file in 5000-row batches, and without an offset index every
 * batch re-decoded the data page that contained it — 28 s for a 1M-row file. It now walks
 * each column once. What must not change is the answer: the first N matching rows, in row
 * order, case-insensitively, `formatCellValue`-rendered.
 */

function generated() {
  const buffer = parquetWriteBuffer({
    columnData: [
      { name: "id", data: Int32Array.from([1, 2, 3, 4, 5]), type: "INT32" },
      { name: "name", data: ["alpha", "beta", "gamma", "alpha-2", "delta"], type: "STRING" },
      { name: "note", data: ["x", "needle-here", "y", "z", "needle-too"], type: "STRING" },
    ],
  });
  return openParquetFile(buffer);
}

const NESTED_FIXTURE = new URL("../fixtures/parquet-list-column.parquet", import.meta.url);

async function nested() {
  const buffer = await readFile(NESTED_FIXTURE);
  return openParquetFile(
    buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
  );
}

test("search: matches a substring of any column, case-insensitively", async () => {
  const info = await generated();

  const result = await searchParquetValues(info, "NEEDLE");

  assert.deepEqual(result.rows, [1, 4]);
  assert.equal(result.capped, false);
  assert.equal(result.cancelled, false);
});

test("search: reports which column matched for every row it keeps", async () => {
  const info = await generated();

  const result = await searchParquetValues(info, "needle");
  assert.deepEqual(result.rows, [1, 4]);
  // Both hits sit in `note`, the third column: without this the UI can only scroll rows,
  // so a hit on column 47 of 60 lands off-screen with no marker at all.
  assert.deepEqual(result.columns, [2, 2]);

  const numeric = await searchParquetValues(info, "3");
  assert.deepEqual(numeric.rows, [2]);
  assert.deepEqual(numeric.columns, [0]);
});

test("search: numeric columns are matched as their display text", async () => {
  const info = await generated();

  const result = await searchParquetValues(info, "3");

  // id 3 and name "gamma" both contain a 3? only the id row does.
  assert.deepEqual(result.rows, [2]);
});

test("search: no match still reports the whole file as scanned", async () => {
  const info = await generated();

  const result = await searchParquetValues(info, "zzz-not-here");

  assert.deepEqual(result.rows, []);
  assert.equal(result.scanned, 5);
});

test("search: the earliest maxRows matches are kept and the cap is reported", async () => {
  const info = await generated();

  const result = await searchParquetValues(info, "a", { maxRows: 2 });

  assert.deepEqual(result.rows, [0, 1], "rows stay in file order, not match order");
  assert.equal(result.capped, true);
});

test("search: cancellation returns nothing and says so", async () => {
  const info = await generated();

  const result = await searchParquetValues(info, "a", { isCancelled: () => true });

  assert.deepEqual(result.rows, []);
  assert.equal(result.cancelled, true);
});

test("search: progress is monotonic and ends on the row count", async () => {
  const info = await generated();
  const samples: Array<[number, number]> = [];

  const result = await searchParquetValues(info, "needle", {
    onProgress: (scanned, matches) => samples.push([scanned, matches]),
  });

  assert.ok(samples.length > 0, "progress must be reported at least once");
  for (let index = 1; index < samples.length; index++) {
    assert.ok(samples[index][0] >= samples[index - 1][0], "scanned must not go backwards");
  }
  assert.deepEqual(samples[samples.length - 1], [info.rowCount, result.rows.length]);
});

test("search: nested columns are searched as their assembled JSON", async () => {
  const info = await nested();

  const result = await searchParquetValues(info, "ko");

  // "ko" appears in `tags` (LIST) and in `meta` (STRUCT) of row 1 only.
  assert.deepEqual(result.rows, [0]);
  assert.equal(result.capped, false);
});

test("search: a nested column that matches nothing leaves the result empty", async () => {
  const info = await nested();

  const result = await searchParquetValues(info, "not-in-any-cell");

  assert.deepEqual(result.rows, []);
  assert.equal(result.scanned, info.rowCount);
});
