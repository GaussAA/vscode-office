/**
 * 1 GB-scale fixtures for the baseline measurement (docs/agents/perf-baseline-1gb.md).
 *
 *   node scripts/perf/fixtures-1gb.mjs                  # generate everything missing
 *   node scripts/perf/fixtures-1gb.mjs --only=jsonl1g,csv199
 *
 * Every fixture is streamed to disk: rows are produced a few MB at a time, written with
 * backpressure, and counted in bytes by the writer itself (never by `stat` on a file that is
 * still being written). A fixture is written to `<name>.partial` and renamed only after the
 * byte count matches the file on disk, so an interrupted run can never leave a truncated file
 * that a later run mistakes for a finished one. Each fixture has a `<name>.meta.json` sidecar
 * (record count, needles) so cached runs know what they are measuring.
 *
 * Sizes are chosen against the limits in the source, not round numbers:
 *   json99    just under JSON_MAX_ARRAY_BYTES (100 MiB)
 *   csv199    just under TEXT_WINDOW_MAX_BYTES (200 MiB)
 *   json300 / json1g / csv500 / csv1g / tsv500   over the limits, to see what a user gets
 *   jsonl1g   5,000,000 lines, ~1 GiB (JSONL has no size limit in the host)
 */
import { once } from "node:events";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const MiB = 1024 * 1024;
const FLUSH_BYTES = 4 * MiB;

/**
 * Stream `produce` into `path`. `produce(out)` calls `out.write(text)`; when that returns a
 * promise (the buffer is full) the producer must await it. Returns the producer's metadata
 * merged with the final byte size.
 */
async function generate(path, produce) {
  const metaPath = `${path}.meta.json`;
  if (existsSync(path) && existsSync(metaPath) && statSync(path).size > 0) {
    return { path, cached: true, ...JSON.parse(readFileSync(metaPath, "utf8")) };
  }

  const partial = `${path}.partial`;
  rmSync(partial, { force: true });
  const stream = createWriteStream(partial);
  let streamError = null;
  stream.on("error", (error) => {
    streamError = error;
  });

  let parts = [];
  let buffered = 0;
  let written = 0;

  async function flush() {
    if (streamError) throw streamError;
    const chunk = parts.join("");
    written += buffered;
    parts = [];
    buffered = 0;
    if (!stream.write(chunk)) await once(stream, "drain");
  }

  const out = {
    /** Bytes produced so far, flushed or not. */
    get size() {
      return written + buffered;
    },
    write(text) {
      parts.push(text);
      buffered += Buffer.byteLength(text);
      return buffered >= FLUSH_BYTES ? flush() : undefined;
    },
  };

  try {
    const meta = await produce(out);
    await flush();
    stream.end();
    await once(stream, "finish");
    const onDisk = statSync(partial).size;
    if (onDisk !== written) {
      throw new Error(`wrote ${written} bytes but the file is ${onDisk} bytes`);
    }
    renameSync(partial, path);
    const finalMeta = { bytes: onDisk, ...meta };
    writeFileSync(metaPath, `${JSON.stringify(finalMeta, null, 2)}\n`);
    return { path, cached: false, ...finalMeta };
  } catch (error) {
    stream.destroy();
    rmSync(partial, { force: true });
    throw error;
  }
}

/** `await out.write(...)` without paying a microtask per row unless a flush is pending. */
async function emit(out, text) {
  const pending = out.write(text);
  if (pending) await pending;
}

// ---------------------------------------------------------------------------------------------
// JSONL: 5,000,000 lines of an application log, ~218 bytes each (~1.0 GiB).
// ---------------------------------------------------------------------------------------------

export const JSONL_1G_LINES = 5_000_000;
const BASE_TS = Date.UTC(2026, 10, 18);
const hex8 = (n, k) => (Math.imul(n, k) >>> 0).toString(16).padStart(8, "0");

export function jsonlLine(i) {
  const level = i % 10 === 0 ? "ERROR" : i % 5 === 0 ? "WARN" : "INFO";
  const ok = i % 3 !== 0;
  return (
    `{"id":${i},"ts":"${new Date(BASE_TS + i * 17).toISOString()}","level":"${level}",` +
    `"service":"worker-${i % 20}","trace":"${hex8(i, 2654435761)}${hex8(i, 40503)}${hex8(i, 2246822519)}",` +
    `"user":"u-${String(i % 100000).padStart(6, "0")}",` +
    `"msg":"processed ${i} rows in batch ${(i / 1000) | 0} with status ${ok ? "ok" : "retry"}",` +
    `"dur_ms":${i % 997},"ok":${ok}}\n`
  );
}

async function produceJsonl(out) {
  for (let i = 0; i < JSONL_1G_LINES; i++) await emit(out, jsonlLine(i));
  return {
    kind: "jsonl",
    records: JSONL_1G_LINES,
    // few hits: only the last line; many hits: every tenth line (capped by the host);
    // none: absent.
    needleFew: `processed ${JSONL_1G_LINES - 1} rows`,
    needleMany: '"level":"ERROR"',
    needleNone: "zzz-no-such-token",
  };
}

// ---------------------------------------------------------------------------------------------
// JSON: one top-level array of ~2 KB records.
// ---------------------------------------------------------------------------------------------

const JSON_PAD = "x".repeat(1800);

function jsonRecord(i, last) {
  const level = i % 10 === 0 ? "ERROR" : i % 5 === 0 ? "WARN" : "INFO";
  return JSON.stringify({
    id: i,
    ts: new Date(BASE_TS + i * 17).toISOString(),
    level,
    service: `svc-${i % 20}`,
    message: last ? `final-needle-marker record ${i}` : `record ${i} processed`,
    pad: JSON_PAD,
  });
}

async function produceJsonArray(out, targetBytes) {
  await emit(out, "[");
  let count = 0;
  for (;;) {
    const separator = count > 0 ? "," : "";
    const plain = jsonRecord(count, false);
    // The record that would cross the target is the last one and carries the needle.
    const last = out.size + separator.length + plain.length + 64 >= targetBytes;
    await emit(out, separator + (last ? jsonRecord(count, true) : plain));
    count++;
    if (last) break;
  }
  await emit(out, "]");
  return {
    kind: "json",
    records: count,
    needleFew: "final-needle-marker",
    needleMany: '"level":"ERROR"',
    needleNone: "zzz-no-such-token",
  };
}

// ---------------------------------------------------------------------------------------------
// CSV / TSV: 8 columns, ~75 bytes a row. CSV carries the awkward cases a real export has: a
// quoted field with a comma every 7th row and a quoted embedded newline every 5,003rd row.
// TSV puts a comma in the same field unquoted (it is not the delimiter there).
// ---------------------------------------------------------------------------------------------

const TABLE_HEADER = ["id", "name", "score", "ok", "note", "city", "day", "tag"];

function tableRow(row, delimiter, last) {
  let note = last ? `final-needle-row ${row}` : `note ${row} lorem`;
  let embeddedNewlines = 0;
  if (!last && delimiter === ",") {
    if (row % 5003 === 0) {
      note = `"note ${row}\nsecond line"`;
      embeddedNewlines = 1;
    } else if (row % 7 === 0) {
      note = `"note, ${row} lorem"`;
    }
  } else if (!last && row % 7 === 0) {
    note = `note, ${row} lorem`;
  }
  const fields = [
    row,
    `service-${row % 500}`,
    (row % 10000) / 100,
    row % 3 === 0,
    note,
    "beijing",
    "2026-11-18",
    `tag${row % 20}`,
  ];
  return { text: `${fields.join(delimiter)}\n`, embeddedNewlines };
}

async function produceTable(out, delimiter, targetBytes) {
  await emit(out, `${TABLE_HEADER.join(delimiter)}\n`);
  let rows = 0;
  let lines = 1;
  for (;;) {
    const row = rows + 1;
    const probe = tableRow(row, delimiter, false);
    const last = out.size + probe.text.length + 64 >= targetBytes;
    const chosen = last ? tableRow(row, delimiter, true) : probe;
    await emit(out, chosen.text);
    rows++;
    lines += 1 + chosen.embeddedNewlines;
    if (last) break;
  }
  return {
    kind: delimiter === "," ? "csv" : "tsv",
    records: rows,
    lines,
    needleFew: "final-needle-row",
    needleMany: "tag7",
    needleNone: "zzz-no-such-token",
  };
}

export const FIXTURES = {
  jsonl1g: { file: "jsonl-1gib-5m.jsonl", make: produceJsonl },
  json99: { file: "json-array-99mib.json", make: (out) => produceJsonArray(out, 99 * MiB) },
  json300: { file: "json-array-300mib.json", make: (out) => produceJsonArray(out, 300 * MiB) },
  json1g: { file: "json-array-1gib.json", make: (out) => produceJsonArray(out, 1024 * MiB) },
  csv199: { file: "csv-199mib.csv", make: (out) => produceTable(out, ",", 199 * MiB) },
  csv500: { file: "csv-500mib.csv", make: (out) => produceTable(out, ",", 500 * MiB) },
  csv1g: { file: "csv-1gib.csv", make: (out) => produceTable(out, ",", 1024 * MiB) },
  tsv500: { file: "tsv-500mib.tsv", make: (out) => produceTable(out, "\t", 500 * MiB) },
};

/** Generate (or reuse) the named fixtures, sequentially. Returns `{ key: { path, bytes, ... } }`. */
export async function ensure1GbFixtures(cacheDir, keys = Object.keys(FIXTURES), log = () => {}) {
  mkdirSync(cacheDir, { recursive: true });
  const result = {};
  for (const key of keys) {
    const spec = FIXTURES[key];
    if (!spec)
      throw new Error(`unknown fixture "${key}" (known: ${Object.keys(FIXTURES).join(", ")})`);
    const started = Date.now();
    const made = await generate(join(cacheDir, spec.file), spec.make);
    log(
      `${key.padEnd(8)} ${spec.file}  ${(made.bytes / MiB).toFixed(1)} MiB  ` +
        `${made.records.toLocaleString()} records  ` +
        (made.cached ? "cached" : `generated in ${((Date.now() - started) / 1000).toFixed(1)} s`),
    );
    result[key] = made;
  }
  return result;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const only = process.argv.find((argument) => argument.startsWith("--only="));
  const keys = only ? only.slice("--only=".length).split(",") : undefined;
  const repoRoot = join(fileURLToPath(import.meta.url), "..", "..", "..");
  await ensure1GbFixtures(join(repoRoot, ".perf"), keys, console.log);
}
