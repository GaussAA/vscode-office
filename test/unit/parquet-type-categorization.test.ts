import { test } from "node:test";
import assert from "node:assert/strict";
import { categorizeType } from "../../src/react/view/parquet/parquetParser.ts";

test("categorizeType: identifies boolean types", () => {
  assert.strictEqual(categorizeType("BOOLEAN"), "bool");
  assert.strictEqual(categorizeType("boolean"), "bool");
  assert.strictEqual(categorizeType("BOOL"), "bool");
});

test("categorizeType: identifies numeric types", () => {
  assert.strictEqual(categorizeType("INT32"), "numeric");
  assert.strictEqual(categorizeType("INT64"), "numeric");
  assert.strictEqual(categorizeType("FLOAT"), "numeric");
  assert.strictEqual(categorizeType("DOUBLE"), "numeric");
  assert.strictEqual(categorizeType("DECIMAL"), "numeric");
  assert.strictEqual(categorizeType("NUMERIC"), "numeric");
});

test("categorizeType: identifies string types", () => {
  assert.strictEqual(categorizeType("STRING"), "string");
  assert.strictEqual(categorizeType("UTF8"), "string");
  assert.strictEqual(categorizeType("BYTE_ARRAY"), "string");
  assert.strictEqual(categorizeType("CHAR"), "string");
  assert.strictEqual(categorizeType("UUID"), "string");
  assert.strictEqual(categorizeType("ENUM"), "string");
});

test("categorizeType: identifies datetime types", () => {
  assert.strictEqual(categorizeType("TIMESTAMP"), "datetime");
  assert.strictEqual(categorizeType("TIMESTAMP_MILLIS"), "datetime");
  assert.strictEqual(categorizeType("DATE"), "datetime");
  assert.strictEqual(categorizeType("TIME"), "datetime");
});

test("categorizeType: identifies structure types", () => {
  assert.strictEqual(categorizeType("JSON"), "structure");
  assert.strictEqual(categorizeType("STRUCT"), "structure");
  assert.strictEqual(categorizeType("MAP"), "structure");
  assert.strictEqual(categorizeType("LIST"), "structure");
  assert.strictEqual(categorizeType("LIST<STRING>"), "structure");
  assert.strictEqual(categorizeType("MAP<INT32, STRING>"), "structure");
});

test("categorizeType: prioritizes ENUM as string over numeric", () => {
  // ENUM contains "NUM" but should be treated as string
  assert.strictEqual(categorizeType("ENUM"), "string");
});

test("categorizeType: prioritizes structure over other types", () => {
  // LIST<INT32> contains INT but should be structure
  assert.strictEqual(categorizeType("LIST<INT32>"), "structure");
  assert.strictEqual(categorizeType("MAP<STRING, INT64>"), "structure");
});

test("categorizeType: handles unknown types as field", () => {
  assert.strictEqual(categorizeType("UNKNOWN"), "field");
  assert.strictEqual(categorizeType("CUSTOM_TYPE"), "field");
  assert.strictEqual(categorizeType(""), "field");
});

test("categorizeType: is case-insensitive", () => {
  assert.strictEqual(categorizeType("int64"), "numeric");
  assert.strictEqual(categorizeType("INT64"), "numeric");
  assert.strictEqual(categorizeType("Int64"), "numeric");
});

test("categorizeType: handles complex nested types", () => {
  assert.strictEqual(categorizeType("LIST<STRUCT<a:INT32,b:STRING>>"), "structure");
  assert.strictEqual(categorizeType("MAP<STRING,LIST<INT32>>"), "structure");
});
