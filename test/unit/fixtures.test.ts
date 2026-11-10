import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { decodeCsvBuffer } from "@/react/view/excel/csvEncoding";
import { parseCsv } from "@/react/view/excel/csvParser";
import { openParquetFile, readParquetRows } from "@/react/view/parquet/parquetParser";
import { buildJsonlIndex, readJsonlLineText, summarizeDecodedLine } from "@/service/jsonlDocument";

/**
 * Every file under `test/fixtures/{parquet,spreadsheet,jsonl}` is produced by
 * `scripts/generate-test-fixtures.mjs`. This file is what makes them evidence: a fixture that no
 * test reads says nothing about the viewer.
 */
const fixture = (path: string) => new URL(`../fixtures/${path}`, import.meta.url);

async function bytesOf(path: string): Promise<ArrayBuffer> {
  const buffer = await readFile(fixture(path));
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

// ---------------------------------------------------------------- parquet

const CODECS: Array<[file: string, rows: number, lastId: number]> = [
  ["snappy", 1000, 1000],
  ["gzip", 500, 500],
  ["uncompressed", 300, 300],
  ["lz4", 800, 800],
  ["brotli", 600, 600],
];

for (const [name, rows, lastId] of CODECS) {
  test(`parquet codec: ${name} opens, and its first and last rows decode`, async () => {
    const info = await openParquetFile(await bytesOf(`parquet/${name}.parquet`));
    assert.equal(info.rowCount, rows);

    const first = await readParquetRows(info.file, info.metadata, 0, 1);
    const last = await readParquetRows(info.file, info.metadata, rows - 1, rows);
    assert.equal(first[0].id, 1);
    assert.equal(last[0].id, lastId);
  });
}

test("parquet shape: an empty file has columns and no rows", async () => {
  const info = await openParquetFile(await bytesOf("parquet/empty.parquet"));
  assert.equal(info.rowCount, 0);
  assert.deepEqual(
    info.columns.map((column) => column.name),
    ["id"],
  );
  assert.deepEqual(await readParquetRows(info.file, info.metadata, 0, 50), []);
});

test("parquet shape: a single row and a single column", async () => {
  const one = await openParquetFile(await bytesOf("parquet/single-row.parquet"));
  assert.deepEqual(await readParquetRows(one.file, one.metadata, 0, 50), [{ id: 1, name: "only" }]);

  const col = await openParquetFile(await bytesOf("parquet/single-column.parquet"));
  assert.deepEqual(
    (await readParquetRows(col.file, col.metadata, 0, 50)).map((row) => row.value),
    [1, 2, 3, 4, 5],
  );
});

test("parquet shape: nested.parquet keeps LIST and STRUCT columns under their top-level name", async () => {
  const info = await openParquetFile(await bytesOf("parquet/nested.parquet"));
  assert.deepEqual(
    info.columns.map((column) => [column.name, column.type]),
    [
      ["id", "STRING"],
      ["tags", "LIST"],
      ["meta", "STRUCT"],
    ],
  );
});

test("parquet shape: a read past the end is clamped, not an error", async () => {
  const info = await openParquetFile(await bytesOf("parquet/single-column.parquet"));
  assert.equal((await readParquetRows(info.file, info.metadata, 3, 9999)).length, 2);
  assert.deepEqual(await readParquetRows(info.file, info.metadata, 99, 120), []);
});

test("parquet: a file that is not parquet is rejected with the footer error", async () => {
  await assert.rejects(
    openParquetFile(await bytesOf("parquet/corrupted.parquet")),
    /footer != PAR1/,
  );
});

// ------------------------------------------------------------------- csv

test("csv: a UTF-8 BOM is stripped before parsing", async () => {
  const raw = new Uint8Array(await bytesOf("spreadsheet/utf8-bom.csv"));
  assert.deepEqual([...raw.subarray(0, 3)], [0xef, 0xbb, 0xbf], "fixture must really have a BOM");

  const { rows } = parseCsv(decodeCsvBuffer(raw.buffer.slice(0) as ArrayBuffer));
  assert.ok(rows.length > 1);
  assert.ok(!rows[0][0].startsWith("\uFEFF"), `header cell kept the BOM: ${rows[0][0]}`);
});

test("csv: quotes, embedded commas and embedded newlines stay inside their cell", async () => {
  const { rows, delimiter } = parseCsv(
    decodeCsvBuffer(await bytesOf("spreadsheet/quotes-newlines.csv")),
  );
  assert.equal(delimiter, ",");
  assert.deepEqual(rows[0], ["id", "text", "note"]);
  assert.equal(rows.length, 5);
  assert.equal(rows[2][1], 'Text with "nested quotes"');
  assert.equal(rows[3][1], "Multi-line\ntext here");
  assert.equal(rows[4][1], "Comma, in text");
  assert.ok(rows.every((row) => row.length === 3));
});

test("csv: a tab-separated file is detected as TSV", async () => {
  const { rows, delimiter } = parseCsv(decodeCsvBuffer(await bytesOf("spreadsheet/sample.tsv")));
  assert.equal(delimiter, "\t");
  assert.deepEqual(rows[0], ["id", "name", "score", "note"]);
  assert.equal(rows.length, 4);
});

test("csv: empty and header-only files produce no data rows", async () => {
  assert.deepEqual(parseCsv(decodeCsvBuffer(await bytesOf("spreadsheet/empty.csv"))).rows, []);
  const header = parseCsv(decodeCsvBuffer(await bytesOf("spreadsheet/header-only.csv"))).rows;
  assert.deepEqual(header, [["id", "name", "score"]]);
});

test("csv: a file without a header is all data", async () => {
  const { rows } = parseCsv(decodeCsvBuffer(await bytesOf("spreadsheet/no-header.csv")));
  assert.deepEqual(rows[0], ["1", "apple", "10.5"]);
  assert.equal(rows.length, 3);
});

// ----------------------------------------------------------------- jsonl

async function jsonlLines(name: string) {
  const bytes = new Uint8Array(await bytesOf(`jsonl/${name}.jsonl`));
  const index = buildJsonlIndex(bytes);
  const lines = [];
  for (let line = 0; line < index.lineCount; line++) {
    lines.push(summarizeDecodedLine(line, readJsonlLineText(bytes, index, line)));
  }
  return lines;
}

test("jsonl: bad lines are classified per line and do not stop the lines after them", async () => {
  const kinds = (await jsonlLines("invalid-lines")).map((entry) => entry.kind);
  assert.deepEqual(kinds.slice(0, 7), [
    "value",
    "invalid",
    "value",
    "invalid",
    "value",
    "empty",
    "value",
  ]);
});

test("jsonl: keys and value types may differ on every line", async () => {
  const lines = await jsonlLines("mixed-key-types");
  assert.equal(lines.length, 4);
  assert.ok(lines.every((entry) => entry.kind === "value"));
});

test("jsonl: unicode survives decoding", async () => {
  const bytes = new Uint8Array(await bytesOf("jsonl/unicode.jsonl"));
  const index = buildJsonlIndex(bytes);
  const text = Array.from(
    { length: index.lineCount },
    (_, line) => readJsonlLineText(bytes, index, line).text,
  ).join("\n");
  assert.ok(!text.includes("\uFFFD"), "a replacement character means a decoding error");
  assert.ok(/[\u4e00-\u9fff]/.test(text), "the fixture should contain CJK text");
});

test("jsonl: deep nesting and a 600-field entry are still values", async () => {
  assert.ok((await jsonlLines("deep-nested")).every((entry) => entry.kind === "value"));
  // Line 0 and 2 are small; the 600-field object sits in `fields` on line 1.
  const lines = await jsonlLines("large-entry");
  assert.deepEqual(
    lines.map((entry) => entry.kind),
    ["value", "value", "value"],
  );
  const bytes = new Uint8Array(await bytesOf("jsonl/large-entry.jsonl"));
  const wide = readJsonlLineText(bytes, buildJsonlIndex(bytes), 1).text;
  assert.equal(Object.keys(JSON.parse(wide).fields).length, 600);
});

test("jsonl: an empty file exposes one empty line", async () => {
  const lines = await jsonlLines("empty");
  assert.equal(lines.length, 1);
  assert.equal(lines[0].kind, "empty");
});
