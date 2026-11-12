/**
 * Fixtures for the performance gate.
 *
 * The parquet shapes differ on purpose:
 *  - `flat` and `wide` are **one row group**, which is what PyArrow produces by default
 *    (`_DEFAULT_ROW_GROUP_SIZE = 1024 * 1024` rows). That is the shape that used to cost the
 *    whole file twice on first paint, so it is the shape the gate has to keep measuring.
 *  - `profile` is **ten row groups**, which is what polars (512² = 262 144 rows per group) and
 *    DuckDB (122 880) produce. Row-group statistics only mean anything across groups: with a
 *    single group every statistic comes from that one group and pruning cannot exist.
 *
 * They are generated into `.perf/` and reused, so a warm run adds no work.
 */
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { zstdCompressSync } from "node:zlib";
import { parquetWriteBuffer } from "hyparquet-writer";

const FLAT_ROWS = 1_000_000;
const WIDE_ROWS = 200_000;
const WIDE_TEXT_COLUMNS = 30;
const WIDE_NUMBER_COLUMNS = 29;
const CSV_ROWS = 280_000;

function writeIfMissing(path, create) {
  if (existsSync(path) && statSync(path).size > 0) return path;
  const bytes = create();
  writeFileSync(path, new Uint8Array(bytes));
  return path;
}

export function createPerfFixtures(cacheDir) {
  mkdirSync(cacheDir, { recursive: true });

  const flat = writeIfMissing(join(cacheDir, "flat-1m-1rg.parquet"), () => {
    const ids = new Int32Array(FLAT_ROWS);
    const names = new Array(FLAT_ROWS);
    const scores = new Float64Array(FLAT_ROWS);
    const oks = new Array(FLAT_ROWS);
    const notes = new Array(FLAT_ROWS);
    for (let index = 0; index < FLAT_ROWS; index++) {
      ids[index] = index + 1;
      // 500 distinct values: dictionary encoded, like a real dimension column.
      names[index] = `service-${index % 500}`;
      scores[index] = (index % 10000) / 100;
      oks[index] = index % 3 === 0;
      notes[index] = `note ${index} lorem ipsum dolor sit amet`;
    }
    return parquetWriteBuffer({
      columnData: [
        { name: "id", data: ids, type: "INT32" },
        { name: "name", data: names, type: "STRING" },
        { name: "score", data: scores, type: "DOUBLE" },
        { name: "ok", data: oks, type: "BOOLEAN" },
        { name: "note", data: notes, type: "STRING" },
      ],
      rowGroupSize: FLAT_ROWS,
    });
  });

  const wide = writeIfMissing(join(cacheDir, "wide-200k-60col.parquet"), () => {
    const ids = Int32Array.from({ length: WIDE_ROWS }, (_, index) => index + 1);
    const columnData = [{ name: "id", data: ids, type: "INT32" }];
    for (let column = 0; column < WIDE_NUMBER_COLUMNS; column++) {
      const values = new Float64Array(WIDE_ROWS);
      for (let index = 0; index < WIDE_ROWS; index++) {
        values[index] = ((index * (column + 3)) % 1000) / 7;
      }
      columnData.push({ name: `m${column}`, data: values, type: "DOUBLE" });
    }
    for (let column = 0; column < WIDE_TEXT_COLUMNS; column++) {
      const values = new Array(WIDE_ROWS);
      for (let index = 0; index < WIDE_ROWS; index++) values[index] = `s${column}-${index % 97}`;
      columnData.push({ name: `s${column}`, data: values, type: "STRING" });
    }
    return parquetWriteBuffer({ columnData, rowGroupSize: WIDE_ROWS });
  });

  // Just under the 25 MB size guard and well over the 8 MB window threshold: the file the
  // windowed view exists for. 8 columns, ~70 bytes per row.
  const flatCsv = writeIfMissing(join(cacheDir, "flat-20mb.csv"), () => {
    const lines = ["id,name,score,ok,note,city,day,tag"];
    for (let index = 1; index <= CSV_ROWS; index++) {
      lines.push(
        `${index},service-${index % 500},${(index % 10000) / 100},${index % 3 === 0},note ${index} lorem ipsum,beijing,2026-11-09,tag${index % 20}`,
      );
    }
    return Buffer.from(`${lines.join("\n")}\n`, "utf8");
  });

  return {
    flat,
    flatCsv,
    flatCsvRows: CSV_ROWS + 1,
    flatCsvBytes: statSync(flatCsv).size,
    flatRows: FLAT_ROWS,
    flatBytes: statSync(flat).size,
    /** A needle that only exists in the very last row: the scan cannot stop early. */
    flatLastRowNeedle: `note ${FLAT_ROWS - 1} `,
    wide,
    wideRows: WIDE_ROWS,
    wideBytes: statSync(wide).size,
    wideNeedle: `s${WIDE_TEXT_COLUMNS - 1}-96`,
    ...createProfilePerfFixtures(cacheDir),
    ...createJsonlPerfFixtures(cacheDir),
    ...createJsonPerfFixtures(cacheDir),
  };
}

/**
 * JSONL host fixtures. The viewer's expensive half is in the extension host (line index,
 * window parsing, whole-file search), so these are measured in Node, not the browser:
 *  - 40 lines x ~2 MB: a 500-line window would parse 80 MB; the 4 MB byte budget parses one.
 *  - 200k short lines: a whole-file search has to stay one pass.
 */
const JSONL_HUGE_LINES = 40;
const JSONL_HUGE_PAD = 2 * 1024 * 1024;
const JSONL_LOG_LINES = 200_000;

export function createJsonlPerfFixtures(cacheDir) {
  mkdirSync(cacheDir, { recursive: true });

  const huge = writeIfMissing(join(cacheDir, "jsonl-huge-lines.jsonl"), () => {
    const lines = [];
    for (let index = 0; index < JSONL_HUGE_LINES; index++) {
      lines.push(
        JSON.stringify({ id: index, pad: "x".repeat(JSONL_HUGE_PAD), tag: `row-${index}` }),
      );
    }
    return Buffer.from(`${lines.join("\n")}\n`, "utf8");
  });

  const log = writeIfMissing(join(cacheDir, "jsonl-log-200k.jsonl"), () => {
    const chunks = [];
    let text = "";
    for (let index = 0; index < JSONL_LOG_LINES; index++) {
      text += `{"id":${index},"ts":"2026-11-09T10:00:00.123Z","level":"INFO","msg":"processed ${index} rows","service":"ingest","ok":true}\n`;
      if (text.length > 1 << 20) {
        chunks.push(text);
        text = "";
      }
    }
    chunks.push(text);
    return Buffer.from(chunks.join(""), "utf8");
  });

  return {
    jsonlHuge: huge,
    jsonlHugeLines: JSONL_HUGE_LINES,
    jsonlHugeBytes: statSync(huge).size,
    jsonlLog: log,
    jsonlLogLines: JSONL_LOG_LINES,
    jsonlLogBytes: statSync(log).size,
    /** Appears once, in the last line: the scan cannot stop early. */
    jsonlLogNeedle: `processed ${JSONL_LOG_LINES - 1} rows`,
  };
}
/**
 * JSON host fixture: a top-level array just under the 100 MiB preview cap. Each record is a
 * few kilobytes; the marker exists only in the last record so the search cannot stop early.
 */
const JSON_ARRAY_RECORDS = 50_000;
const JSON_ARRAY_PAD = 1_800;

export function createJsonPerfFixtures(cacheDir) {
  mkdirSync(cacheDir, { recursive: true });
  const array = writeIfMissing(join(cacheDir, "json-array-100mb.json"), () => {
    const chunks = ["["];
    for (let index = 0; index < JSON_ARRAY_RECORDS; index++) {
      if (index > 0) chunks.push(",");
      chunks.push(
        JSON.stringify({
          id: index,
          ts: "2026-11-09T10:00:00.123Z",
          level: "INFO",
          service: "ingest",
          message:
            index === JSON_ARRAY_RECORDS - 1
              ? "final-needle-marker processed the last record"
              : `processed ${index} rows`,
          pad: "x".repeat(JSON_ARRAY_PAD),
        }),
      );
    }
    chunks.push("]");
    return Buffer.from(chunks.join(""), "utf8");
  });
  return {
    jsonArray: array,
    jsonArrayRecords: JSON_ARRAY_RECORDS,
    jsonArrayBytes: statSync(array).size,
    jsonArrayNeedle: "final-needle-marker",
  };
}

/**
 * Column-profile fixtures. Two shapes, because a profile has two paths to prove:
 *
 *  - `profile-1m-10rg.parquet`: 1M rows across **ten** row groups, ZSTD, and the columns the
 *    real files have — a nullable string, a JSON string, and a column of JSON arrays. Node's
 *    `zstdCompressSync` supplies the compressor: `hyparquet-writer` only ships SNAPPY and would
 *    otherwise label uncompressed pages as ZSTD. `name` also carries a bloom filter, and the
 *    columns get a column index where the writer emits one, because pruning depends on both.
 *    Note what this fixture is *not*: `hyparquet-writer` turns an array column into a JSON
 *    string, so it cannot produce a real `LIST` group. Nested coverage stays on
 *    `test/fixtures/parquet/nested.parquet`.
 *  - `profile-nostats-100k.parquet`: the same shape written with `statistics: false`. Row-group
 *    statistics are optional in the format, so "this file has no statistics" is a state the UI
 *    has to state rather than paper over.
 *
 * Measured on this machine (Node 24, cold `.perf/`): generating both takes 4.7 s, the file is
 * 4.3 MB, a metadata-only read is 4–8 ms, and a **full decode is 1.5 s**. That last number is
 * why the profile budget cannot be a wall-clock threshold alone — a 4 MB fixture decodes inside
 * a 2 s budget — so the gate asserts the bytes read, not just the time.
 */
const PROFILE_ROWS = 1_000_000;
const PROFILE_ROW_GROUP = 100_000;
const PROFILE_NO_STATS_ROWS = 100_000;

export function createProfilePerfFixtures(cacheDir) {
  mkdirSync(cacheDir, { recursive: true });

  const profile = writeIfMissing(join(cacheDir, "profile-1m-10rg.parquet"), () => {
    const ids = new Int32Array(PROFILE_ROWS);
    const names = new Array(PROFILE_ROWS);
    const scores = new Float64Array(PROFILE_ROWS);
    const oks = new Array(PROFILE_ROWS);
    const notes = new Array(PROFILE_ROWS);
    const metas = new Array(PROFILE_ROWS);
    const tagLists = new Array(PROFILE_ROWS);
    for (let index = 0; index < PROFILE_ROWS; index++) {
      ids[index] = index + 1;
      // Every 13th name is null, so `null_count` has something to report.
      names[index] = index % 13 === 0 ? null : `service-${index % 500}`;
      scores[index] = (index % 10000) / 100;
      oks[index] = index % 3 === 0;
      notes[index] = `note ${index} lorem ipsum dolor sit amet`;
      metas[index] =
        index % 17 === 0 ? null : JSON.stringify({ ok: index % 3 === 0, n: index % 5 });
      tagLists[index] = index % 29 === 0 ? null : [`a${index % 4}`, `b${index % 6}`];
    }
    return parquetWriteBuffer({
      columnData: [
        { name: "id", data: ids, type: "INT32", columnIndex: true },
        {
          name: "name",
          data: names,
          type: "STRING",
          nullable: true,
          columnIndex: true,
          bloomFilter: true,
        },
        { name: "score", data: scores, type: "DOUBLE", columnIndex: true },
        { name: "ok", data: oks, type: "BOOLEAN", columnIndex: true },
        { name: "note", data: notes, type: "STRING", columnIndex: true },
        { name: "meta_json", data: metas, type: "JSON", nullable: true, columnIndex: true },
        { name: "tags_json", data: tagLists, type: "JSON", nullable: true, columnIndex: true },
      ],
      rowGroupSize: PROFILE_ROW_GROUP,
      codec: "ZSTD",
      compressors: { ZSTD: (input) => new Uint8Array(zstdCompressSync(input)) },
    });
  });

  const noStats = writeIfMissing(join(cacheDir, "profile-nostats-100k.parquet"), () => {
    const ids = new Int32Array(PROFILE_NO_STATS_ROWS);
    const names = new Array(PROFILE_NO_STATS_ROWS);
    for (let index = 0; index < PROFILE_NO_STATS_ROWS; index++) {
      ids[index] = index + 1;
      names[index] = index % 11 === 0 ? null : `service-${index % 500}`;
    }
    return parquetWriteBuffer({
      columnData: [
        { name: "id", data: ids, type: "INT32" },
        { name: "name", data: names, type: "STRING", nullable: true },
      ],
      rowGroupSize: PROFILE_NO_STATS_ROWS / 2,
      statistics: false,
    });
  });

  return {
    profile,
    profileRows: PROFILE_ROWS,
    profileRowGroups: PROFILE_ROWS / PROFILE_ROW_GROUP,
    profileBytes: statSync(profile).size,
    /** Only in the last row group: a scan that stops early misses it. */
    profileLastRowNeedle: `note ${PROFILE_ROWS - 1} `,
    profileNoStats: noStats,
    profileNoStatsRows: PROFILE_NO_STATS_ROWS,
    profileNoStatsBytes: statSync(noStats).size,
  };
}
