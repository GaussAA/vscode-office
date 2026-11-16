import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";
import { columnIndex, columnLabel } from "@/common/columnLabel";
import { columnName } from "@/react/view/excel/windowedSheetModel";
import {
  expr2xy,
  indexAt,
  stringAt,
  xy2expr,
} from "@/react/view/excel/x-spreadsheet/core/alphabet";

/**
 * Column letters existed three times (excel_meta, windowedSheetModel, alphabet.js) and two were
 * wrong from column 702 on (index 728 gave BAA, not ABA). Every consumer is compared with
 * SheetJS over Excel's whole column range, so a fourth copy cannot drift unnoticed.
 */

/** Excel's last column is XFD (index 16383). */
const MAX_COLUMN = 16384;

function mismatches(label: (index: number) => string): string[] {
  const bad: string[] = [];
  for (let index = 0; index < MAX_COLUMN; index++) {
    const expected = XLSX.utils.encode_col(index);
    const actual = label(index);
    if (actual !== expected) bad.push(`${index}: ${actual} (expected ${expected})`);
  }
  return bad;
}

test("columnLabel matches SheetJS encode_col for every column", () => {
  const bad = mismatches(columnLabel);
  assert.deepEqual(bad.slice(0, 5), [], `${bad.length} wrong labels`);
});

test("columnIndex matches SheetJS decode_col for every column", () => {
  const bad: string[] = [];
  for (let index = 0; index < MAX_COLUMN; index++) {
    const letters = XLSX.utils.encode_col(index);
    if (columnIndex(letters) !== index) bad.push(`${letters}: ${columnIndex(letters)}`);
  }
  assert.deepEqual(bad.slice(0, 5), [], `${bad.length} wrong indexes`);
});

test("columnIndex accepts lowercase and returns -1 for an empty label", () => {
  assert.equal(columnIndex(""), -1);
  assert.equal(columnIndex("abc"), columnIndex("ABC"));
  assert.equal(columnLabel(columnIndex("ZZZ")), "ZZZ");
});

test("windowedSheetModel.columnName matches SheetJS for every column", () => {
  const bad = mismatches(columnName);
  assert.deepEqual(bad.slice(0, 5), [], `${bad.length} wrong labels`);
});

test("alphabet.js stringAt matches SheetJS for every column", () => {
  const bad = mismatches(stringAt);
  assert.deepEqual(bad.slice(0, 5), [], `${bad.length} wrong labels`);
});

test("alphabet.js indexAt matches SheetJS decode_col for every column", () => {
  const bad: string[] = [];
  for (let index = 0; index < MAX_COLUMN; index++) {
    const letters = XLSX.utils.encode_col(index);
    if (indexAt(letters) !== index) bad.push(`${letters}: ${indexAt(letters)}`);
  }
  assert.deepEqual(bad.slice(0, 5), []);
});

test("alphabet.js xy2expr / expr2xy round-trip over the full column range", () => {
  const bad: string[] = [];
  for (let x = 0; x < MAX_COLUMN; x++) {
    const expr = xy2expr(x, 6);
    const [cx, cy] = expr2xy(expr);
    if (expr !== `${XLSX.utils.encode_col(x)}7` || cx !== x || cy !== 6) bad.push(`${x}: ${expr}`);
  }
  assert.deepEqual(bad.slice(0, 5), [], `${bad.length} bad addresses`);
});
