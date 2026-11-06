import assert from "node:assert/strict";
import test from "node:test";
import {
  categorizeType,
  formatCellValue,
  isColumnEditable,
  parseCellInput,
} from "@/react/view/parquet/parquetParser";

test("categorizeType: one decode for the icon, the alignment and editability", () => {
  const cases = {
    BOOLEAN: "bool",
    INT32: "numeric",
    INT64: "numeric",
    DOUBLE: "numeric",
    FLOAT: "numeric",
    "DECIMAL(10,2)": "numeric",
    INTERVAL: "numeric",
    "TIMESTAMP(MILLIS,true)": "datetime",
    TIMESTAMP_MILLIS: "datetime",
    DATE: "datetime",
    TIME_MILLIS: "datetime",
    STRING: "string",
    BYTE_ARRAY: "string",
    UTF8: "string",
    "LIST<STRING>": "structure",
    STRUCT: "structure",
    MAP: "structure",
    JSON: "structure",
    UNKNOWN: "field",
  };
  for (const [type, expected] of Object.entries(cases)) {
    assert.equal(categorizeType(type), expected, type);
  }
});

test("categorizeType: a nested type is a structure, not whatever it contains", () => {
  // The old icon check looked for STRING before LIST, so a list of strings got the string icon.
  assert.equal(categorizeType("LIST<STRING>"), "structure");
  assert.equal(categorizeType("MAP<STRING,INT32>"), "structure");
});

test("isColumnEditable: only structures are read-only", () => {
  for (const type of ["BOOLEAN", "INT32", "DOUBLE", "TIMESTAMP_MILLIS", "STRING", "UNKNOWN"]) {
    assert.equal(isColumnEditable(type), true, type);
  }
  for (const type of ["STRUCT", "LIST<INT32>", "MAP<STRING,INT32>", "JSON"]) {
    assert.equal(isColumnEditable(type), false, type);
  }
});

test("parseCellInput: a structure column parses JSON, a insert column keeps text", () => {
  assert.deepEqual(parseCellInput("[1,2]", "LIST<INT32>"), [1, 2]);
  assert.deepEqual(parseCellInput('{"a":1}', "STRUCT"), { a: 1 });
  assert.equal(parseCellInput("abc", "LIST<INT32>"), "abc", "unparsable input is kept verbatim");
  assert.equal(parseCellInput("12", "STRING"), "12", "a string column must not coerce digits");
  assert.equal(parseCellInput("12", "INT32"), 12);
});

test('formatCellValue: null and undefined render as empty, not "null"', () => {
  assert.equal(formatCellValue(null), "");
  assert.equal(formatCellValue(undefined), "");
});

test("formatCellValue: keeps precision for bigint and ISO for dates", () => {
  assert.equal(formatCellValue(9007199254740993n), "9007199254740993");
  assert.equal(formatCellValue(new Date("2026-11-05T00:00:00Z")), "2026-11-05T00:00:00.000Z");
});

test("formatCellValue: serialises objects and stringifies scalars", () => {
  assert.equal(formatCellValue({ a: 1 }), '{"a":1}');
  assert.equal(formatCellValue([1, 2]), "[1,2]");
  assert.equal(formatCellValue(true), "true");
  assert.equal(formatCellValue(3.5), "3.5");
});

test("parseCellInput: empty input clears the cell", () => {
  assert.equal(parseCellInput("", "INT32"), null);
  assert.equal(parseCellInput("   ", "STRING"), null);
});

test("parseCellInput: integer columns truncate", () => {
  assert.equal(parseCellInput("42", "INT32"), 42);
  assert.equal(parseCellInput(" 3.9 ", "INT64"), 3);
  assert.equal(parseCellInput("-7", "INT32"), -7);
});

test("parseCellInput: floating columns keep the fraction", () => {
  assert.equal(parseCellInput("3.9", "DOUBLE"), 3.9);
  assert.equal(parseCellInput("1e3", "FLOAT"), 1000);
});

test("parseCellInput: boolean columns accept common spellings", () => {
  assert.equal(parseCellInput("true", "BOOLEAN"), true);
  assert.equal(parseCellInput("yes", "BOOLEAN"), true);
  assert.equal(parseCellInput("0", "BOOLEAN"), false);
  assert.equal(parseCellInput("maybe", "BOOLEAN"), "maybe", "unknown words are kept verbatim");
});

test("parseCellInput: unparsable numbers fall back to the raw text", () => {
  assert.equal(parseCellInput("abc", "INT32"), "abc");
  assert.equal(parseCellInput("12abc", "DOUBLE"), "12abc");
});
