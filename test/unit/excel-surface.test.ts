import assert from "node:assert/strict";
import test from "node:test";
import {
  computeExcelSurface,
  type ExcelSurface,
  type ExcelSurfaceInput,
} from "@/react/view/excel/excelSurface";

/**
 * Excel.tsx used to repeat `!loading && !loadError && !tooLarge && !windowSource` per element.
 * The table below states the rule once, for every combination of the four inputs, in the order
 * loading > error > guard > window > grid.
 */

interface Row {
  loading: boolean;
  loadError: boolean;
  tooLarge: boolean;
  windowSource: boolean;
  expected: ExcelSurface;
}

function expectedFor(row: Omit<Row, "expected">): ExcelSurface {
  if (row.loading) return "loading";
  if (row.loadError) return "error";
  if (row.tooLarge) return "guard";
  if (row.windowSource) return "window";
  return "grid";
}

const bools = [false, true];
const TABLE: Row[] = [];
for (const loading of bools)
  for (const loadError of bools)
    for (const tooLarge of bools)
      for (const windowSource of bools) {
        const row = { loading, loadError, tooLarge, windowSource };
        TABLE.push({ ...row, expected: expectedFor(row) });
      }

function inputOf(row: Row): ExcelSurfaceInput {
  return {
    loading: row.loading,
    loadError: row.loadError ? "failed" : null,
    tooLarge: row.tooLarge,
    windowSource: row.windowSource ? {} : null,
  };
}

test("surface: every combination of the four inputs maps to one surface", () => {
  assert.equal(TABLE.length, 16);
  for (const row of TABLE) {
    assert.equal(
      computeExcelSurface(inputOf(row)),
      row.expected,
      `loading=${row.loading} error=${row.loadError} guard=${row.tooLarge} window=${row.windowSource}`,
    );
  }
});

test("surface: the five surfaces are all reachable", () => {
  const reached = new Set(TABLE.map((row) => computeExcelSurface(inputOf(row))));
  assert.deepEqual([...reached].sort(), ["error", "grid", "guard", "loading", "window"]);
});

test("surface: an empty-string load error still counts as no error", () => {
  assert.equal(
    computeExcelSurface({ loading: false, loadError: "", tooLarge: false, windowSource: null }),
    "grid",
  );
});
