import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  formatCellValue,
  openParquetFile,
  readParquetRows,
  writeParquetBuffer,
} from "@/react/view/parquet/parquetParser";

/**
 * A tiny file with every shape the column model must survive: a scalar, a LIST and a
 * STRUCT (see the fixture's generator note in the PR). The old `openParquetFile` listed
 * *physical leaf* columns — `tags.list.element` — while `parquetReadObjects` keys rows
 * by the top-level name, so every nested column rendered as all-NULL.
 */
const FIXTURE = new URL("../fixtures/parquet-list-column.parquet", import.meta.url);

async function openFixture() {
  const buffer = await readFile(FIXTURE);
  return openParquetFile(
    buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
  );
}

test("openParquetFile: nested columns appear once, under their top-level name", async () => {
  const info = await openFixture();

  assert.deepEqual(
    info.columns.map((column) => column.name),
    ["id", "tags", "meta"],
  );
});

test("openParquetFile: a LIST column is a structure, so it is not editable", async () => {
  const info = await openFixture();

  const tags = info.columns.find((column) => column.name === "tags");
  assert.ok(tags, "tags column must be listed");
  assert.equal(tags.type, "LIST");
  assert.equal(tags.category, "structure");
  assert.equal(tags.editable, false);
});

test("readParquetRows: list values are reachable under the column name", async () => {
  const info = await openFixture();
  const rows = await readParquetRows(info.file, info.metadata, 0, 2);

  assert.equal(rows[0]["id"], "row-1");
  assert.deepEqual(rows[0]["tags"], ["ko", "en"]);
  // A fully-null row may omit the key entirely (hyparquet's object format), so coalesce.
  assert.equal(rows[1]["tags"] ?? null, null);
});

test("formatCellValue renders list values instead of an empty cell", async () => {
  const info = await openFixture();
  const rows = await readParquetRows(info.file, info.metadata, 0, 1);

  const tags = info.columns.find((column) => column.name === "tags");
  assert.ok(tags, "tags column must be listed");
  assert.match(formatCellValue(rows[0][tags.name]), /ko/);
});

test("writeParquetBuffer refuses nested columns instead of downgrading them", async () => {
  const info = await openFixture();
  const rows = await readParquetRows(info.file, info.metadata, 0, 2);

  // Saving would re-encode `tags` as a JSON string column (the writer only does flat
  // columns). A clear refusal beats silent data mangling.
  assert.throws(() => writeParquetBuffer(info.columns, rows), /nested columns/);
});
