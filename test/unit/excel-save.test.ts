import { test } from "node:test";
import assert from "node:assert/strict";
import { chooseExcelSaveRoute } from "../../src/react/view/excel/excelSave";

test("excel save route: read-only always goes through Save As", () => {
  assert.equal(
    chooseExcelSaveRoute({ readOnly: true, ext: ".xlsx", formattingChanged: false }),
    "save-as",
  );
});

test("excel save route: formatting that a format cannot keep asks first", () => {
  assert.equal(
    chooseExcelSaveRoute({ readOnly: false, ext: ".xls", formattingChanged: true }),
    "format-confirm",
  );
  assert.equal(
    chooseExcelSaveRoute({ readOnly: false, ext: ".csv", formattingChanged: true }),
    "format-confirm",
  );
});

test("excel save route: xlsx/xlsm and unchanged formats save direct", () => {
  assert.equal(
    chooseExcelSaveRoute({ readOnly: false, ext: ".xlsx", formattingChanged: true }),
    "direct",
  );
  assert.equal(
    chooseExcelSaveRoute({ readOnly: false, ext: "xlsm", formattingChanged: true }),
    "direct",
  );
  assert.equal(
    chooseExcelSaveRoute({ readOnly: false, ext: ".xls", formattingChanged: false }),
    "direct",
  );
});
