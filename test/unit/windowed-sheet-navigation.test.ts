import assert from "node:assert/strict";
import test from "node:test";
import { HEADER_HEIGHT, ROW_HEIGHT } from "@/react/view/excel/windowedSheetModel";
import {
  bodyScrollTopFor,
  clampCell,
  moveCell,
  pageRows,
  resolveSelection,
  rowScrollFor,
  scrollerTopForRow,
  startingCell,
  withLoadedValue,
  type RowVisibilityState,
} from "@/react/view/excel/windowedSheetNavigation";

const bounds = { rowCount: 100, columnCount: 5 };
const key = (name: string, ctrl = false) => ({ key: name, ctrl });

test("pageRows: one viewport minus a row of overlap, never below one", () => {
  assert.equal(pageRows(ROW_HEIGHT * 10), 9);
  assert.equal(pageRows(0), 1);
  assert.equal(pageRows(ROW_HEIGHT), 1);
});

test("startingCell: the selection, else the first rendered row, else the origin", () => {
  assert.deepEqual(startingCell({ row: 7, col: 2 }, { start: 40 }), { row: 7, col: 2 });
  assert.deepEqual(startingCell(null, { start: 40 }), { row: 40, col: 0 });
  assert.deepEqual(startingCell(null, null), { row: 0, col: 0 });
});

test("moveCell: arrows move one cell and clamp at the edges", () => {
  assert.deepEqual(moveCell({ row: 3, col: 2 }, key("ArrowDown"), bounds, 9), { row: 4, col: 2 });
  assert.deepEqual(moveCell({ row: 3, col: 2 }, key("ArrowUp"), bounds, 9), { row: 2, col: 2 });
  assert.deepEqual(moveCell({ row: 3, col: 2 }, key("ArrowLeft"), bounds, 9), { row: 3, col: 1 });
  assert.deepEqual(moveCell({ row: 3, col: 2 }, key("ArrowRight"), bounds, 9), { row: 3, col: 3 });
  assert.deepEqual(moveCell({ row: 0, col: 0 }, key("ArrowUp"), bounds, 9), { row: 0, col: 0 });
  assert.deepEqual(moveCell({ row: 0, col: 0 }, key("ArrowLeft"), bounds, 9), { row: 0, col: 0 });
  assert.deepEqual(moveCell({ row: 99, col: 4 }, key("ArrowDown"), bounds, 9), {
    row: 99,
    col: 4,
  });
  assert.deepEqual(moveCell({ row: 99, col: 4 }, key("ArrowRight"), bounds, 9), {
    row: 99,
    col: 4,
  });
});

test("moveCell: paging moves by the page size and clamps", () => {
  assert.deepEqual(moveCell({ row: 10, col: 1 }, key("PageDown"), bounds, 9), { row: 19, col: 1 });
  assert.deepEqual(moveCell({ row: 10, col: 1 }, key("PageUp"), bounds, 9), { row: 1, col: 1 });
  assert.deepEqual(moveCell({ row: 95, col: 1 }, key("PageDown"), bounds, 9), { row: 99, col: 1 });
  assert.deepEqual(moveCell({ row: 3, col: 1 }, key("PageUp"), bounds, 9), { row: 0, col: 1 });
});

test("moveCell: Home/End stay in the row, Ctrl+Home/End go to the grid corners", () => {
  assert.deepEqual(moveCell({ row: 10, col: 3 }, key("Home"), bounds, 9), { row: 10, col: 0 });
  assert.deepEqual(moveCell({ row: 10, col: 3 }, key("End"), bounds, 9), { row: 10, col: 4 });
  assert.deepEqual(moveCell({ row: 10, col: 3 }, key("Home", true), bounds, 9), {
    row: 0,
    col: 0,
  });
  assert.deepEqual(moveCell({ row: 10, col: 3 }, key("End", true), bounds, 9), {
    row: 99,
    col: 4,
  });
});

test("moveCell: other keys and an empty grid are not navigation", () => {
  assert.equal(moveCell({ row: 0, col: 0 }, key("a"), bounds, 9), null);
  assert.equal(moveCell({ row: 0, col: 0 }, key("Enter"), bounds, 9), null);
  assert.equal(
    moveCell({ row: 0, col: 0 }, key("ArrowDown"), { rowCount: 0, columnCount: 3 }, 9),
    null,
  );
});

test("clampCell: both axes clamp independently", () => {
  assert.deepEqual(clampCell({ row: -5, col: 99 }, bounds), { row: 0, col: 4 });
  assert.deepEqual(clampCell({ row: 500, col: -1 }, bounds), { row: 99, col: 0 });
});

test("resolveSelection: a rendered row supplies its value without a read", () => {
  const rows = [
    ["a", "b"],
    ["c", "d"],
  ];
  const resolved = resolveSelection({ row: 11, col: 1 }, bounds, rows, 10);
  assert.deepEqual(resolved, { selection: { row: 11, col: 1, value: "d" }, needsRead: false });
});

test("resolveSelection: a row outside the window needs a read and starts empty", () => {
  const rows = [["a", "b"]];
  assert.deepEqual(resolveSelection({ row: 50, col: 0 }, bounds, rows, 10), {
    selection: { row: 50, col: 0, value: "" },
    needsRead: true,
  });
  assert.deepEqual(resolveSelection({ row: 5, col: 0 }, bounds, rows, 10)?.needsRead, true);
});

test("resolveSelection: the cell is clamped, and an empty grid selects nothing", () => {
  const resolved = resolveSelection({ row: 999, col: 999 }, bounds, [], 0);
  assert.deepEqual(resolved?.selection, { row: 99, col: 4, value: "" });
  assert.equal(resolveSelection({ row: 0, col: 0 }, { rowCount: 0, columnCount: 3 }, [], 0), null);
});

test("resolveSelection: a short rendered row yields an empty value, not a read", () => {
  const resolved = resolveSelection({ row: 0, col: 3 }, bounds, [["only"]], 0);
  assert.deepEqual(resolved, { selection: { row: 0, col: 3, value: "" }, needsRead: false });
});

test("withLoadedValue: a late read lands only on the cell it was requested for", () => {
  const current = { row: 50, col: 2, value: "" };
  assert.deepEqual(withLoadedValue(current, { row: 50, col: 2 }, ["x", "y", "z"]), {
    row: 50,
    col: 2,
    value: "z",
  });
  // The user moved on: the late read must not overwrite the new selection.
  assert.equal(withLoadedValue(current, { row: 49, col: 2 }, ["x", "y", "z"]), current);
  assert.equal(withLoadedValue(current, { row: 50, col: 1 }, ["x", "y", "z"]), current);
  assert.equal(withLoadedValue(null, { row: 50, col: 2 }, ["x"]), null);
});

test("withLoadedValue: a missing row or short row becomes an empty value", () => {
  const current = { row: 50, col: 2, value: "old" };
  assert.equal(withLoadedValue(current, { row: 50, col: 2 }, undefined)?.value, "");
  assert.equal(withLoadedValue(current, { row: 50, col: 2 }, ["x"])?.value, "");
});

test("bodyScrollTopFor: the header offset applies only outside compressed seek mode", () => {
  assert.equal(bodyScrollTopFor(HEADER_HEIGHT + 100, false), 100);
  assert.equal(bodyScrollTopFor(10, false), 0);
  assert.equal(bodyScrollTopFor(HEADER_HEIGHT + 100, true), HEADER_HEIGHT + 100);
  assert.equal(bodyScrollTopFor(-5, true), 0);
});

test("scrollerTopForRow: the body row's scroll offset sits below the frozen header", () => {
  const viewport = { rowHeight: ROW_HEIGHT, viewportHeight: 220, totalRows: 1000, overscan: 4 };
  // Row 0 cannot be centered, so the body offset is 0 and the grid sits at the header height.
  assert.equal(scrollerTopForRow(0, viewport), HEADER_HEIGHT);
  const centered = 500 * ROW_HEIGHT - (220 - ROW_HEIGHT) / 2;
  assert.equal(scrollerTopForRow(500, viewport), HEADER_HEIGHT + centered);
});

const normal = (over: Partial<RowVisibilityState> = {}): RowVisibilityState => ({
  compressed: false,
  range: { start: 0, end: 20 },
  scrollTop: HEADER_HEIGHT,
  bodyViewportHeight: ROW_HEIGHT * 10,
  dataRowCount: 1000,
  ...over,
});

test("rowScrollFor: a fully visible row does not scroll", () => {
  assert.deepEqual(rowScrollFor(0, normal()), { kind: "none" });
  assert.deepEqual(rowScrollFor(9, normal()), { kind: "none" });
});

test("rowScrollFor: a row below the fold scrolls so it sits at the bottom edge", () => {
  assert.deepEqual(rowScrollFor(10, normal()), {
    kind: "scroll",
    top: HEADER_HEIGHT + 10 * ROW_HEIGHT - ROW_HEIGHT * 10 + ROW_HEIGHT,
  });
});

test("rowScrollFor: a row above the fold scrolls so it sits at the top edge", () => {
  const state = normal({ scrollTop: HEADER_HEIGHT + 50 * ROW_HEIGHT });
  assert.deepEqual(rowScrollFor(40, state), {
    kind: "scroll",
    top: HEADER_HEIGHT + 40 * ROW_HEIGHT,
  });
});

test("rowScrollFor: the target never scrolls past the end of the body", () => {
  const state = normal({ dataRowCount: 30 });
  const maxBody = 30 * ROW_HEIGHT - ROW_HEIGHT * 10;
  assert.deepEqual(rowScrollFor(29, state), { kind: "scroll", top: HEADER_HEIGHT + maxBody });
});

test("rowScrollFor: a partly hidden row counts as not visible", () => {
  const state = normal({ scrollTop: HEADER_HEIGHT + 5 });
  const result = rowScrollFor(0, state);
  assert.deepEqual(result, { kind: "scroll", top: HEADER_HEIGHT });
});

test("rowScrollFor: compressed mode keeps rows inside the rendered range and seeks otherwise", () => {
  const state = normal({ compressed: true, range: { start: 100, end: 120 } });
  assert.deepEqual(rowScrollFor(100, state), { kind: "none" });
  assert.deepEqual(rowScrollFor(119, state), { kind: "none" });
  assert.deepEqual(rowScrollFor(120, state), { kind: "seek" });
  assert.deepEqual(rowScrollFor(99, state), { kind: "seek" });
  assert.deepEqual(rowScrollFor(5, { ...state, range: null }), { kind: "seek" });
});
