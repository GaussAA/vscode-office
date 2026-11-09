import assert from "node:assert/strict";
import test from "node:test";
import { categorizeType, formatCellValue } from "@/react/view/parquet/parquetParser";

test("categorizeType: one decode for the icon and the alignment", () => {
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
