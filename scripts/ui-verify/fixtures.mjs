/**
 * Fixtures for the UI verification run.
 *
 * Everything except the committed zstd sample is generated locally, so the suite has no
 * network dependency: the zstd file is the one upstream couldn't read (the reason this
 * fork exists), and the big/mixed files are written by hyparquet-writer. The nested
 * sample is the unit-test fixture, served as-is so both layers cover the same file.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parquetWriteBuffer } from "hyparquet-writer";

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(here, "..", "..");

/** Committed sample: 300 rows, two DOUBLE/FLOAT columns, ZSTD compressed. */
const zstdSample = join(here, "fixtures", "zstd.parquet");

/**
 * Committed sample: a one-paragraph docx. Without it the harness hands the Word route an
 * empty buffer, the viewer renders "Empty file content", and "the route mounted" says
 * nothing about whether the editor works. A .docx is a zip, so it is generated once and
 * committed rather than built here.
 */
const docxSample = join(here, "fixtures", "smoke.docx");

/** Committed unit-test fixture: one scalar, one LIST<UTF8>, one plain STRUCT. */
const nestedSample = join(repoRoot, "test", "fixtures", "parquet-list-column.parquet");

const BIG_ROWS = 250_000;
const EDIT_LIMIT = 200_000;

function writeIfMissing(path, create) {
  if (existsSync(path) && statSync(path).size > 0) return path;
  const bytes = create();
  writeFileSync(path, new Uint8Array(bytes));
  return path;
}

export function createFixtures(cacheDir) {
  mkdirSync(cacheDir, { recursive: true });
  if (!existsSync(zstdSample)) {
    throw new Error(`missing committed fixture: ${zstdSample}`);
  }
  if (!existsSync(docxSample)) {
    throw new Error(`missing committed fixture: ${docxSample}`);
  }
  if (!existsSync(nestedSample)) {
    throw new Error(`missing committed fixture: ${nestedSample}`);
  }

  const mixed = writeIfMissing(join(cacheDir, "mixed.parquet"), () => {
    const n = 300;
    const ids = new Int32Array(n);
    const names = [];
    const flags = [];
    const scores = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      ids[i] = i + 1;
      names.push(`service-${String.fromCharCode(97 + (i % 26))}-${i}`);
      flags.push(i % 3 === 0);
      scores[i] = Math.round(Math.sin(i / 7) * 10000) / 100;
    }
    return parquetWriteBuffer({
      columnData: [
        { name: "id", data: ids, type: "INT32" },
        { name: "name", data: names, type: "STRING" },
        { name: "active", data: flags, type: "BOOLEAN" },
        { name: "score", data: scores, type: "DOUBLE" },
      ],
    });
  });

  const empty = writeIfMissing(join(cacheDir, "empty.parquet"), () =>
    parquetWriteBuffer({
      columnData: [{ name: "id", data: new Int32Array(0), type: "INT32" }],
    }),
  );

  const types = writeIfMissing(join(cacheDir, "types.parquet"), () => {
    const longName = "a very long column name with spaces 中文";
    return parquetWriteBuffer({
      statistics: false,
      columnData: [
        { name: "id", data: [1, 2, 3], type: "INT32" },
        { name: "missing", data: [null, null, null], type: "STRING", nullable: true },
        { name: "when", data: [0, 1_700_000_000_000, 1_700_000_100_000], type: "TIMESTAMP" },
        { name: longName, data: ["alpha", "beta", "gamma"], type: "STRING" },
        {
          name: "blob",
          data: [new Uint8Array([0, 1, 2, 255]), new Uint8Array([9]), new Uint8Array(0)],
          type: "BYTE_ARRAY",
        },
      ],
    });
  });

  const bad = writeIfMissing(join(cacheDir, "bad.parquet"), () => {
    const text = new TextEncoder().encode("this is not a parquet file\n");
    return text.buffer.slice(text.byteOffset, text.byteOffset + text.byteLength);
  });

  const big = writeIfMissing(join(cacheDir, "big.parquet"), () => {
    const ids = new Int32Array(BIG_ROWS);
    const values = new Float64Array(BIG_ROWS);
    for (let i = 0; i < BIG_ROWS; i++) {
      ids[i] = i + 1;
      values[i] = Math.sin(i / 100) * 1000;
    }
    return parquetWriteBuffer({
      columnData: [
        { name: "id", data: ids, type: "INT32" },
        { name: "value", data: values, type: "DOUBLE" },
      ],
    });
  });

  return {
    sample: zstdSample,
    sampleBytes: readFileSync(zstdSample).byteLength,
    docx: docxSample,
    nested: nestedSample,
    mixed,
    empty,
    types,
    bad,
    big,
    bigRows: BIG_ROWS,
    editLimit: EDIT_LIMIT,
  };
}
