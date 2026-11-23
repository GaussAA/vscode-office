import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { openParquetFile, readParquetRows } from "@/common/parquetReader";
import { buildJsonlIndex, readJsonlLineText, summarizeDecodedLine } from "@/service/jsonlDocument";

/**
 * Every file under `test/fixtures/{parquet,jsonl}` is produced by
 * `scripts/generate-test-fixtures.mjs`. This file is what makes them evidence: a fixture that no
 * test reads says nothing about the viewer.
 */
const fixture = (path: string) => new URL(`../fixtures/${path}`, import.meta.url);

async function bytesOf(path: string): Promise<ArrayBuffer> {
  const buffer = await readFile(fixture(path));
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

// ---------------------------------------------------------------- parquet

/**
 * One row per codec fixture. The codec is asserted from the file's own metadata, not trusted
 * from the fixture name: these five files were once all SNAPPY because the generator passed
 * `compression:` instead of `codec:`, so "gzip opens" proved nothing about gzip.
 *
 * LZ4 has no Node compressor, so both LZ4 fixtures store literals only. They prove the codec
 * name and the framing; the match-copy path is not fixture-backed.
 */
const CODECS: Array<[file: string, codec: string, rows: number, lastId: number]> = [
  ["snappy", "SNAPPY", 1000, 1000],
  ["gzip", "GZIP", 500, 500],
  ["brotli", "BROTLI", 600, 600],
  ["zstd", "ZSTD", 700, 700],
  ["lz4", "LZ4", 800, 800],
  ["lz4-raw", "LZ4_RAW", 400, 400],
  ["uncompressed", "UNCOMPRESSED", 300, 300],
];

for (const [name, codec, rows, lastId] of CODECS) {
  test(`parquet codec: ${name} declares ${codec}, and its first and last rows decode`, async () => {
    const info = await openParquetFile(await bytesOf(`parquet/${name}.parquet`));
    const declared = new Set(
      info.metadata.row_groups.flatMap((group) =>
        group.columns.map((column) => column.meta_data?.codec),
      ),
    );
    assert.deepEqual([...declared], [codec], `${name}.parquet declares ${[...declared].join()}`);
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
  const text = Array.from({ length: index.lineCount }, (_, line) =>
    readJsonlLineText(bytes, index, line),
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
  const wide = readJsonlLineText(bytes, buildJsonlIndex(bytes), 1);
  assert.equal(Object.keys(JSON.parse(wide).fields).length, 600);
});

test("jsonl: an empty file exposes one empty line", async () => {
  const lines = await jsonlLines("empty");
  assert.equal(lines.length, 1);
  assert.equal(lines[0].kind, "empty");
});
