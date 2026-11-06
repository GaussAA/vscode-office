import assert from "node:assert/strict";
import test from "node:test";
import {
  findAllInSheets,
  replaceAllInSheets,
  replaceCellText,
} from "@/react/view/excel/excel_find";
import type { SheetData } from "@/react/view/excel/x-spreadsheet/index";

/**
 * The vendored spreadsheet's `SheetData` is loosely typed (`rows` is a numeric index plus a
 * `len`, cell records are optional), which makes every read in a test a possible-undefined
 * dance. The fixture below states the exact shape the viewer builds, so the assertions can read
 * like assertions; `asSheets()` is the single boundary where that shape becomes `SheetData`.
 */
interface FixtureCell {
  text: string;
}

interface FixtureRow {
  cells: Record<number, FixtureCell>;
}

interface FixtureSheet {
  name: string;
  rows: { len: number } & Record<number, FixtureRow>;
}

function makeSheets(): FixtureSheet[] {
  return [
    {
      name: "Sheet1",
      rows: {
        len: 2,
        0: { cells: { 0: { text: "alpha" }, 1: { text: "beta" } } },
        1: { cells: { 0: { text: "alphabet" } } },
      },
    },
    {
      name: "Sheet2",
      rows: { len: 1, 0: { cells: { 0: { text: "gamma" } } } },
    },
  ];
}

const asSheets = (sheets: FixtureSheet[]): SheetData[] => sheets as unknown as SheetData[];

const options = { matchCase: false, wholeCell: false };

test("replaceCellText: replaces the matched cell and reports true", () => {
  const sheets = makeSheets();
  const changed = replaceCellText(
    asSheets(sheets),
    { sheetIndex: 0, ri: 0, ci: 0 },
    "alpha",
    "ALPHA",
    options,
  );

  assert.equal(changed, true);
  assert.equal(sheets[0].rows[0].cells[0].text, "ALPHA");
});

test("regression: replaceCellText used to index the sheet array with the sheet itself", () => {
  // `sheets[sheetIndexSafe(sheets, i)]` was always `sheets[undefined]`, so every replace
  // returned false and the cell never changed. Both halves are asserted here.
  const sheets = makeSheets();
  const before = sheets[0].rows[0].cells[0].text;

  const changed = replaceCellText(
    asSheets(sheets),
    { sheetIndex: 0, ri: 0, ci: 0 },
    "alpha",
    "omega",
    options,
  );

  assert.equal(changed, true, "a matching cell must be replaced");
  assert.notEqual(sheets[0].rows[0].cells[0].text, before);
});

test("replaceCellText: an out-of-range sheet or cell is a no-op", () => {
  const sheets = makeSheets();
  assert.equal(
    replaceCellText(asSheets(sheets), { sheetIndex: 9, ri: 0, ci: 0 }, "alpha", "x", options),
    false,
  );
  assert.equal(
    replaceCellText(asSheets(sheets), { sheetIndex: 0, ri: 99, ci: 0 }, "alpha", "x", options),
    false,
  );
  assert.equal(
    replaceCellText(asSheets(sheets), { sheetIndex: 0, ri: 0, ci: 99 }, "alpha", "x", options),
    false,
  );
});

test("replaceCellText: a cell that does not contain the term is untouched", () => {
  const sheets = makeSheets();
  assert.equal(
    replaceCellText(asSheets(sheets), { sheetIndex: 0, ri: 0, ci: 1 }, "alpha", "x", options),
    false,
  );
  assert.equal(sheets[0].rows[0].cells[1].text, "beta");
});

test("findAllInSheets: only the active sheet unless allSheets is set", () => {
  const sheets = makeSheets();

  assert.deepEqual(
    findAllInSheets(asSheets(sheets), "alpha", options, 0).map((match) => match.ri),
    [0, 1],
  );
  assert.equal(
    findAllInSheets(asSheets(sheets), "gamma", options, 0).length,
    0,
    "gamma lives on the other sheet",
  );
  assert.equal(
    findAllInSheets(asSheets(sheets), "gamma", { ...options, allSheets: true }, 0).length,
    1,
  );
});

test("replaceAllInSheets: rewrites every match, and wholeCell keeps the longer cell intact", () => {
  const sheets = makeSheets();
  assert.equal(replaceAllInSheets(asSheets(sheets), "alpha", "omega", options), 2);
  assert.equal(sheets[0].rows[0].cells[0].text, "omega");
  assert.equal(sheets[0].rows[1].cells[0].text, "omegabet", "a substring match replaces in place");

  const exact = makeSheets();
  const replaced = replaceAllInSheets(asSheets(exact), "alpha", "omega", {
    ...options,
    wholeCell: true,
  });
  assert.equal(replaced, 1, 'only the cell that is exactly "alpha"');
  assert.equal(exact[0].rows[1].cells[0].text, "alphabet");
});
