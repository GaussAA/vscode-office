import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { SchemaElement } from "hyparquet";
import {
  describeColumn,
  formatCellValue,
  openParquetFile,
  readParquetRows,
} from "@/react/view/parquet/parquetParser";

/**
 * A tiny file with every shape the column model must survive: a scalar, a LIST and a
 * STRUCT (see `test/fixtures/README.md`). The old `openParquetFile` listed *physical
 * leaf* columns — `tags.list.element` — while `parquetReadObjects` keys rows by the
 * top-level name, so every nested column rendered as all-NULL.
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

test("openParquetFile: a LIST column is a structure", async () => {
  const info = await openFixture();

  const tags = info.columns.find((column) => column.name === "tags");
  assert.ok(tags, "tags column must be listed");
  assert.equal(tags.type, "LIST");
  assert.equal(tags.category, "structure");
  assert.equal(tags.nested, true);
});

test("openParquetFile: a plain STRUCT is structural", async () => {
  const info = await openFixture();

  const meta = info.columns.find((column) => column.name === "meta");
  assert.ok(meta, "meta column must be listed");
  assert.equal(meta.type, "STRUCT");
  assert.equal(meta.category, "structure");
  assert.equal(meta.nested, true);
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
  assert.equal(formatCellValue(rows[0][tags.name]), '["ko","en"]');
});

test("describeColumn: a logical-type-only LIST is a structure, not a field", () => {
  const list: SchemaElement = {
    name: "tags",
    num_children: 1,
    logical_type: { type: "LIST" },
  };

  const column = describeColumn(list, true);

  assert.equal(column.type, "LIST");
  assert.equal(column.category, "structure");
  assert.equal(column.nested, true);
});

test("describeColumn: a legacy repeated primitive is structural", () => {
  const repeated: SchemaElement = {
    name: "tags",
    type: "BYTE_ARRAY",
    repetition_type: "REPEATED",
  };

  const column = describeColumn(repeated, false);

  assert.equal(column.category, "structure");
  assert.equal(column.nested, true);
});

test("describeColumn: a flat scalar stays a scalar", () => {
  const flat: SchemaElement = {
    name: "id",
    type: "BYTE_ARRAY",
    converted_type: "UTF8",
    logical_type: { type: "STRING" },
  };

  const column = describeColumn(flat, false);

  assert.equal(column.category, "string");
  assert.equal(column.nested, false);
});
