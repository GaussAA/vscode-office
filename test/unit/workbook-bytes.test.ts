import assert from "node:assert/strict";
import { test } from "node:test";
import * as XLSX from "xlsx";
import { workbookBytes } from "../../src/react/view/excel/workbookBytes";
import type { SheetData } from "../../src/react/view/excel/x-spreadsheet/index";

const sampleSheet: SheetData = {
  name: "Sheet1",
  rows: {
    len: 3,
    0: { cells: { 0: { text: "Name" }, 1: { text: "Age" } } },
    1: { cells: { 0: { text: "Alice" }, 1: { text: "30" } } },
    2: { cells: { 0: { text: "Bob" }, 1: { text: "25" } } },
  },
  cols: { len: 2 },
};

test("workbookBytes: xlsx produces ZIP with PK signature", () => {
  const bytes = workbookBytes([sampleSheet], ".xlsx");
  assert.ok(bytes.length > 4, "xlsx must have bytes");
  assert.equal(bytes[0], 0x50, "xlsx starts with P");
  assert.equal(bytes[1], 0x4b, "xlsx starts with K (ZIP signature)");
});

test("workbookBytes: xlsm produces ZIP with PK signature", () => {
  const bytes = workbookBytes([sampleSheet], ".xlsm");
  assert.ok(bytes.length > 4);
  assert.equal(bytes[0], 0x50);
  assert.equal(bytes[1], 0x4b);
});

test("workbookBytes: xls produces CFB with D0CF11E0 signature", () => {
  const bytes = workbookBytes([sampleSheet], ".xls");
  assert.ok(bytes.length > 8, "xls must have bytes");
  assert.equal(bytes[0], 0xd0, "xls CFB signature byte 0");
  assert.equal(bytes[1], 0xcf, "xls CFB signature byte 1");
  assert.equal(bytes[2], 0x11, "xls CFB signature byte 2");
  assert.equal(bytes[3], 0xe0, "xls CFB signature byte 3");
});

test("workbookBytes: ods produces ZIP and contains mimetype entry", () => {
  const bytes = workbookBytes([sampleSheet], ".ods");
  assert.ok(bytes.length > 4);
  assert.equal(bytes[0], 0x50);
  assert.equal(bytes[1], 0x4b);
  // Search for "mimetype" string in the raw bytes
  const text = new TextDecoder().decode(bytes);
  assert.ok(text.includes("mimetype"), "ods must contain mimetype entry");
  assert.ok(
    text.includes("application/vnd.oasis.opendocument.spreadsheet"),
    "ods mimetype must be correct",
  );
});

test("workbookBytes: csv produces UTF-8 text with commas", () => {
  const bytes = workbookBytes([sampleSheet], ".csv");
  const text = new TextDecoder().decode(bytes);
  assert.ok(text.includes("Name,Age"), "csv must have comma-separated header");
  assert.ok(text.includes("Alice,30"), "csv must have comma-separated data");
});

test("workbookBytes: tsv produces UTF-8 text with tabs", () => {
  const bytes = workbookBytes([sampleSheet], ".tsv");
  const text = new TextDecoder().decode(bytes);
  assert.ok(text.includes("Name\tAge"), "tsv must have tab-separated header");
  assert.ok(text.includes("Alice\t30"), "tsv must have tab-separated data");
});

test("workbookBytes: csv with GBK encoding produces non-UTF-8 bytes", () => {
  const sheet: SheetData = {
    name: "Sheet1",
    rows: {
      len: 2,
      0: { cells: { 0: { text: "姓名" }, 1: { text: "年龄" } } },
      1: { cells: { 0: { text: "张三" }, 1: { text: "30" } } },
    },
    cols: { len: 2 },
  };
  const bytes = workbookBytes([sheet], ".csv", { csvEncoding: "gbk" });
  // GBK encoding produces different bytes than UTF-8
  const utf8 = new TextEncoder().encode("姓名");
  assert.notEqual(bytes[0], utf8[0], "GBK encoding must differ from UTF-8");
});

test("workbookBytes: csv with custom delimiter uses it", () => {
  const bytes = workbookBytes([sampleSheet], ".csv", { csvDelimiter: ";" });
  const text = new TextDecoder().decode(bytes);
  assert.ok(text.includes("Name;Age"), "csv must use custom delimiter");
  assert.ok(text.includes("Alice;30"), "csv must use custom delimiter");
});

test("workbookBytes: round-trip through SheetJS preserves data", () => {
  const bytes = workbookBytes([sampleSheet], ".xlsx");
  const wb = XLSX.read(bytes, { type: "array" });
  assert.equal(wb.SheetNames.length, 1);
  assert.equal(wb.SheetNames[0], "Sheet1");
  const ws = wb.Sheets["Sheet1"];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1 }) as string[][];
  assert.deepEqual(data[0], ["Name", "Age"]);
  assert.deepEqual(data[1], ["Alice", 30]);
  assert.deepEqual(data[2], ["Bob", 25]);
});

test("workbookBytes: xls round-trip preserves data", () => {
  const bytes = workbookBytes([sampleSheet], ".xls");
  const wb = XLSX.read(bytes, { type: "array" });
  const ws = wb.Sheets["Sheet1"];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1 }) as string[][];
  assert.deepEqual(data[0], ["Name", "Age"]);
  assert.deepEqual(data[1], ["Alice", 30]);
});

test("workbookBytes: ods round-trip preserves data", () => {
  const bytes = workbookBytes([sampleSheet], ".ods");
  const wb = XLSX.read(bytes, { type: "array" });
  const ws = wb.Sheets["Sheet1"];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1 }) as string[][];
  assert.deepEqual(data[0], ["Name", "Age"]);
  assert.deepEqual(data[1], ["Alice", 30]);
});

test("workbookBytes: extension without dot is accepted", () => {
  const bytes = workbookBytes([sampleSheet], "xlsx");
  assert.equal(bytes[0], 0x50);
  assert.equal(bytes[1], 0x4b);
});

test("workbookBytes: extension is case-insensitive", () => {
  const bytes = workbookBytes([sampleSheet], ".XLSX");
  assert.equal(bytes[0], 0x50);
  const bytes2 = workbookBytes([sampleSheet], "XlSx");
  assert.equal(bytes2[0], 0x50);
});

test("workbookBytes: unknown extension throws", () => {
  assert.throws(() => workbookBytes([sampleSheet], ".docx"), /Unknown spreadsheet format: \.docx/);
  assert.throws(() => workbookBytes([sampleSheet], ".parquet"), /Unknown spreadsheet format/);
});

test("workbookBytes: multiple sheets are preserved", () => {
  const sheet2: SheetData = {
    name: "Sheet2",
    rows: {
      len: 1,
      0: { cells: { 0: { text: "Data" } } },
    },
    cols: { len: 1 },
  };
  const bytes = workbookBytes([sampleSheet, sheet2], ".xlsx");
  const wb = XLSX.read(bytes, { type: "array" });
  assert.equal(wb.SheetNames.length, 2);
  assert.equal(wb.SheetNames[0], "Sheet1");
  assert.equal(wb.SheetNames[1], "Sheet2");
});

test("workbookBytes: merged cells are preserved", () => {
  const sheetWithMerge: SheetData = {
    ...sampleSheet,
    merges: ["A1:B1"],
  };
  const bytes = workbookBytes([sheetWithMerge], ".xlsx");
  const wb = XLSX.read(bytes, { type: "array" });
  const ws = wb.Sheets["Sheet1"];
  assert.ok(ws["!merges"], "merges must be present");
  assert.equal(ws["!merges"]?.length, 1);
  assert.deepEqual(ws["!merges"]?.[0], { s: { r: 0, c: 0 }, e: { r: 0, c: 1 } });
});

test("workbookBytes: numeric strings that look like numbers become numbers", () => {
  const sheet: SheetData = {
    name: "Sheet1",
    rows: {
      len: 1,
      0: { cells: { 0: { text: "123" }, 1: { text: " 456 " } } },
    },
    cols: { len: 2 },
  };
  const bytes = workbookBytes([sheet], ".xlsx");
  const wb = XLSX.read(bytes, { type: "array" });
  const ws = wb.Sheets["Sheet1"];
  assert.equal(ws["A1"]?.t, "n", "123 must be a number cell");
  assert.equal(ws["A1"]?.v, 123);
  assert.equal(ws["B1"]?.t, "n", "trimmed 456 must be a number cell");
  assert.equal(ws["B1"]?.v, 456);
});

test("workbookBytes: numeric strings with leading zeros stay as text", () => {
  const sheet: SheetData = {
    name: "Sheet1",
    rows: {
      len: 1,
      0: { cells: { 0: { text: "00123" } } },
    },
    cols: { len: 1 },
  };
  const bytes = workbookBytes([sheet], ".xlsx");
  const wb = XLSX.read(bytes, { type: "array" });
  const ws = wb.Sheets["Sheet1"];
  // String(123) !== "00123", so it stays as text
  assert.equal(ws["A1"]?.t, "s", "00123 must stay as text cell");
  assert.equal(ws["A1"]?.v, "00123");
});

test("workbookBytes: formula strings starting with = stay as text", () => {
  const sheet: SheetData = {
    name: "Sheet1",
    rows: {
      len: 1,
      0: { cells: { 0: { text: "=SUM(A1)" } } },
    },
    cols: { len: 1 },
  };
  const bytes = workbookBytes([sheet], ".xlsx");
  const wb = XLSX.read(bytes, { type: "array" });
  const ws = wb.Sheets["Sheet1"];
  // Our code keeps formula strings as literal text, not real formulas
  assert.equal(ws["A1"]?.t, "s", "formula string must be text cell");
  assert.equal(ws["A1"]?.v, "=SUM(A1)");
});
