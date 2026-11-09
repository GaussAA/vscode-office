import assert from "node:assert/strict";
import test from "node:test";
import { createTextSheetSource, indexRecordStarts } from "@/react/view/excel/sheetSource";
import { encodeCsvText } from "@/react/view/excel/csvEncoding";

/**
 * Phase 1 of ADR-0017: rows come back by window, not as a grid of cell objects. The thing that
 * can silently go wrong is the record index — a newline inside a quoted field must not start a
 * row, or every window after it is shifted by one.
 */

const toBuffer = (text: string): ArrayBuffer => {
  const bytes = new TextEncoder().encode(text);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};

const records = (text: string) => indexRecordStarts(new Uint8Array(toBuffer(text)), 0x2c);

test("index: counts records, not lines", () => {
  assert.deepEqual(records("a,b\nc,d\n"), [0, 4]);
  assert.deepEqual(records("a,b\nc,d"), [0, 4]);
  assert.deepEqual(records(""), []);
});

test("index: a newline inside a quoted field is not a record boundary", () => {
  const text = 'id,note\n1,"line one\nline two"\n2,plain\n';

  const starts = records(text);

  assert.equal(starts.length, 3, "the quoted newline must not create a record");
  // Record 2 starts at 8, record 3 at 30 — the newline at 19 is inside the quoted field.
  assert.deepEqual(starts, [0, 8, 30]);
});

test("index: doubled quotes do not close the field early", () => {
  const text = 'a,b\n1,"say ""hi""\nnow"\n';

  assert.equal(records(text).length, 2);
});

test("source: windows return the requested rows and agree with the file", async () => {
  const csv = "id,name\n1,alpha\n2,beta\n3,gamma\n4,delta\n";
  const source = createTextSheetSource(toBuffer(csv));

  assert.equal(source.rowCount, 5);
  assert.equal(source.columnCount, 2);
  assert.deepEqual(await source.readRows(0, 2), [
    ["id", "name"],
    ["1", "alpha"],
  ]);
  assert.deepEqual(await source.readRows(3, 5), [
    ["3", "gamma"],
    ["4", "delta"],
  ]);
  assert.deepEqual(await source.readRows(4, 99), [["4", "delta"]], "end clamps");
  assert.deepEqual(await source.readRows(9, 12), []);
});

test("source: adjacent windows cover the file exactly once", async () => {
  const lines = ["id,value"];
  for (let index = 0; index < 50; index++) lines.push(`${index},v${index}`);
  const source = createTextSheetSource(toBuffer(`${lines.join("\n")}\n`));

  const collected: string[][] = [];
  for (let start = 0; start < source.rowCount; start += 7) {
    collected.push(...(await source.readRows(start, start + 7)));
  }

  assert.deepEqual(
    collected.map((row) => row[0]),
    lines.map((line) => line.split(",")[0]),
  );
});

test("source: a quoted multi-line record is one row in one window", async () => {
  const source = createTextSheetSource(toBuffer('id,note\n1,"first\nsecond"\n2,plain\n'));

  assert.equal(source.rowCount, 3);
  assert.deepEqual(await source.readRows(1, 2), [["1", "first\nsecond"]]);
});

test("source: CRLF and a trailing newline", async () => {
  const source = createTextSheetSource(toBuffer("a,b\r\n1,2\r\n"));

  assert.equal(source.rowCount, 2);
  assert.deepEqual(await source.readRows(1, 2), [["1", "2"]]);
});

test("source: delimiter and encoding are detected once", () => {
  assert.equal(createTextSheetSource(toBuffer("a;b;c\n1;2;3\n")).delimiter, ";");
  assert.equal(createTextSheetSource(toBuffer("a,b\n1,2\n")).encoding, "utf8");

  const gbk = encodeCsvText("名称,数量\n甲,1\n", "gbk");
  const buffer = gbk.buffer.slice(gbk.byteOffset, gbk.byteOffset + gbk.byteLength) as ArrayBuffer;
  const source = createTextSheetSource(buffer);

  assert.equal(source.encoding, "gbk");
  assert.equal(source.rowCount, 2);
});
