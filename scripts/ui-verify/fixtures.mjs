/**
 * Fixtures for the UI verification run.
 *
 * Everything except the committed zstd sample is generated locally, so the suite has no
 * network dependency: the zstd file is the one upstream couldn't read (the reason this
 * fork exists), and the big/mixed files are written by hyparquet-writer.
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
    mixed,
    big,
    bigRows: BIG_ROWS,
    editLimit: EDIT_LIMIT,
  };
}
