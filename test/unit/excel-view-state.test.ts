import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseExcelColorMode,
  parseExcelViewState,
} from "../../src/react/view/excel/excelViewStateModel";

test("excel color mode: only the two known values are accepted", () => {
  assert.equal(parseExcelColorMode("light"), "light");
  assert.equal(parseExcelColorMode("adaptive"), "adaptive");
  assert.equal(parseExcelColorMode("dark"), null);
  assert.equal(parseExcelColorMode(null), null);
});

test("excel view state: a valid stored view parses", () => {
  assert.deepEqual(parseExcelViewState('{"ri":3,"ci":2,"sheetIndex":1}'), {
    ri: 3,
    ci: 2,
    sheetIndex: 1,
  });
});

test("excel view state: malformed JSON and partial objects are rejected", () => {
  assert.equal(parseExcelViewState("{"), null);
  assert.equal(parseExcelViewState("null"), null);
  assert.equal(parseExcelViewState('{"ri":3,"ci":2}'), null);
  assert.equal(parseExcelViewState('{"ri":"3","ci":2,"sheetIndex":1}'), null);
  assert.deepEqual(parseExcelViewState('{"ri":3,"ci":2,"sheetIndex":1.5}'), {
    ri: 3,
    ci: 2,
    sheetIndex: 1,
  });
});

test("excel view state: negative values are normalized before reaching the grid", () => {
  assert.deepEqual(parseExcelViewState('{"ri":-4,"ci":0,"sheetIndex":-1}'), {
    ri: 0,
    ci: 0,
    sheetIndex: 0,
  });
});
