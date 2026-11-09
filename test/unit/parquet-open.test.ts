import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { SchemaElement } from "hyparquet";
import {
  categorizeType,
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

test("readParquetRows: an explicitly UTF8 column stays a string in raw mode", async () => {
  const info = await openFixture();
  const rows = await readParquetRows(info.file, info.metadata, 0, 1, { utf8: false });
  assert.equal(
    rows[0]["id"],
    "row-1",
    "the UTF8 annotation is authoritative; only an unannotated BYTE_ARRAY is bytes",
  );
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

test("formatCellValue: binary bytes render as hex, not control characters", () => {
  assert.equal(formatCellValue(new Uint8Array([0, 1, 2, 255])), "0x00 01 02 ff");
  assert.equal(formatCellValue(new Uint8Array([1, 2, 3])), "0x01 02 03");
  assert.equal(
    formatCellValue({ blob: new Uint8Array([0xff, 0xfe]) }),
    '{"blob":"0xff fe"}',
    "nested binary values must not become numeric-key objects",
  );
  assert.equal(
    formatCellValue("\u0000\u0001\u0002\u00ff", "BYTE_ARRAY"),
    "0x00 01 02 c3 bf",
    "hyparquet hands a plain BYTE_ARRAY back as UTF-8 text; the type must win",
  );
  assert.equal(formatCellValue("hello", "UTF8"), "hello", "a declared string column is not binary");
  assert.equal(
    formatCellValue(new TextEncoder().encode("hello"), "UTF8"),
    "hello",
    "raw UTF-8 bytes from a string column decode back to text",
  );
  assert.equal(
    formatCellValue(new Uint8Array([0, 1, 2, 255]), "BYTE_ARRAY"),
    "0x00 01 02 ff",
    "raw bytes from a binary column stay exact",
  );
});

test("formatCellValue: a UUID is canonical text, not a hex blob", () => {
  const bytes = new Uint8Array([
    0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff,
  ]);
  assert.equal(formatCellValue(bytes, "UUID"), "00112233-4455-6677-8899-aabbccddeeff");
});

test("formatCellValue: a DATE column drops the midnight timestamp", () => {
  const date = new Date("2023-06-15T00:00:00.000Z");
  assert.equal(formatCellValue(date, "DATE"), "2023-06-15");
  assert.equal(formatCellValue(date, "TIMESTAMP"), "2023-06-15T00:00:00.000Z");
});

test("formatCellValue: long binary values are capped but report their size", () => {
  const bytes = new Uint8Array(40).fill(0xab);
  const text = formatCellValue(bytes);
  assert.match(text, /^0xab ab /);
  assert.match(text, /\(40 B\)$/);
});

test("categorizeType: UUID and ENUM are string-like, not unknown fields", () => {
  assert.equal(categorizeType("UUID"), "string");
  assert.equal(categorizeType("ENUM"), "string");
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
