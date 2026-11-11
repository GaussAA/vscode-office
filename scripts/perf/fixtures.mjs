/**
 * Fixtures for the performance gate.
 *
 * Both files are written with **one row group**, which is what PyArrow produces by default
 * (`_DEFAULT_ROW_GROUP_SIZE = 1024 * 1024` rows). That is the shape that used to cost the
 * whole file twice on first paint, so it is the shape the gate has to keep measuring.
 *
 * They are generated into `.perf/` and reused, so a warm run adds no work.
 */
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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
    ...createJsonlPerfFixtures(cacheDir),
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
