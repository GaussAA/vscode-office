import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveParquetKey } from "../../src/react/view/parquet/parquetKeymap.ts";

const baseInput = {
  ctrlKey: false,
  metaKey: false,
  cursor: { row: 5, col: 2 },
  rows: 1000,
  cols: 10,
  page: 2,
  pageCount: 20,
  visibleRows: 50,
  hasCopy: false,
};

test("resolveParquetKey: Escape clears selection", () => {
  const action = resolveParquetKey({ ...baseInput, key: "Escape" });
  assert.deepStrictEqual(action, { type: "escape" });
});

test("resolveParquetKey: Enter inspects cell", () => {
  const action = resolveParquetKey({ ...baseInput, key: "Enter" });
  assert.deepStrictEqual(action, { type: "inspect" });
});

test("resolveParquetKey: ArrowDown moves cursor down", () => {
  const action = resolveParquetKey({ ...baseInput, key: "ArrowDown" });
  assert.deepStrictEqual(action, { type: "reveal", row: 6, col: 2 });
});

test("resolveParquetKey: ArrowUp moves cursor up", () => {
  const action = resolveParquetKey({ ...baseInput, key: "ArrowUp" });
  assert.deepStrictEqual(action, { type: "reveal", row: 4, col: 2 });
});

test("resolveParquetKey: ArrowRight moves cursor right", () => {
  const action = resolveParquetKey({ ...baseInput, key: "ArrowRight" });
  assert.deepStrictEqual(action, { type: "reveal", row: 5, col: 3 });
});

test("resolveParquetKey: ArrowLeft moves cursor left", () => {
  const action = resolveParquetKey({ ...baseInput, key: "ArrowLeft" });
  assert.deepStrictEqual(action, { type: "reveal", row: 5, col: 1 });
});

test("resolveParquetKey: Home moves to start of row", () => {
  const action = resolveParquetKey({ ...baseInput, key: "Home" });
  assert.deepStrictEqual(action, { type: "reveal", row: 5, col: 0 });
});

test("resolveParquetKey: End moves to end of row", () => {
  const action = resolveParquetKey({ ...baseInput, key: "End" });
  assert.deepStrictEqual(action, { type: "reveal", row: 5, col: 9 });
});

test("resolveParquetKey: Ctrl+Home jumps to first page", () => {
  const action = resolveParquetKey({ ...baseInput, key: "Home", ctrlKey: true });
  assert.deepStrictEqual(action, { type: "turn", page: 0, where: "first" });
});

test("resolveParquetKey: Ctrl+End jumps to last page", () => {
  const action = resolveParquetKey({ ...baseInput, key: "End", ctrlKey: true });
  assert.deepStrictEqual(action, { type: "turn", page: 19, where: "last" });
});

test("resolveParquetKey: PageDown moves down one page worth of rows", () => {
  const action = resolveParquetKey({ ...baseInput, key: "PageDown" });
  // PageDown moves by visibleRows (50), so from row 5 to row 55
  assert.deepStrictEqual(action, { type: "reveal", row: 55, col: 2 });
});

test("resolveParquetKey: PageUp turns page when not enough room", () => {
  const action = resolveParquetKey({ ...baseInput, key: "PageUp" });
  // At row 5, PageUp tries to move up by 50 rows (5 - 50 = -45 < 0)
  // So it turns to previous page instead
  assert.deepStrictEqual(action, { type: "turn", page: 1, where: "last" });
});

test("resolveParquetKey: PageUp reveals when there's room", () => {
  const action = resolveParquetKey({
    ...baseInput,
    cursor: { row: 100, col: 2 },
    key: "PageUp",
  });
  // At row 100, PageUp moves up by 50 rows to row 50
  assert.deepStrictEqual(action, { type: "reveal", row: 50, col: 2 });
});

test("resolveParquetKey: Ctrl+C copies when hasCopy is true", () => {
  const action = resolveParquetKey({ ...baseInput, key: "c", ctrlKey: true, hasCopy: true });
  assert.deepStrictEqual(action, { type: "copy" });
});

test("resolveParquetKey: Ctrl+C does nothing when hasCopy is false", () => {
  const action = resolveParquetKey({ ...baseInput, key: "c", ctrlKey: true, hasCopy: false });
  assert.deepStrictEqual(action, { type: "none" });
});

test("resolveParquetKey: clamps column at left edge", () => {
  const action = resolveParquetKey({
    ...baseInput,
    cursor: { row: 5, col: 0 },
    key: "ArrowLeft",
  });
  assert.deepStrictEqual(action, { type: "reveal", row: 5, col: 0 });
});

test("resolveParquetKey: clamps column at right edge", () => {
  const action = resolveParquetKey({
    ...baseInput,
    cursor: { row: 5, col: 9 },
    key: "ArrowRight",
  });
  assert.deepStrictEqual(action, { type: "reveal", row: 5, col: 9 });
});

test("resolveParquetKey: ArrowUp at row 0 turns page", () => {
  const action = resolveParquetKey({
    ...baseInput,
    cursor: { row: 0, col: 2 },
    key: "ArrowUp",
  });
  // At row 0, ArrowUp triggers page turn to previous page
  assert.deepStrictEqual(action, { type: "turn", page: 1, where: "last" });
});

test("resolveParquetKey: null cursor with movement key starts at 0,0", () => {
  const action = resolveParquetKey({
    ...baseInput,
    cursor: null,
    key: "ArrowDown",
  });
  // No cursor + movement key = reveal at 0,0 (doesn't move)
  assert.deepStrictEqual(action, { type: "reveal", row: 0, col: 0 });
});

test("resolveParquetKey: null cursor with ArrowRight starts at 0,0", () => {
  const action = resolveParquetKey({
    ...baseInput,
    cursor: null,
    key: "ArrowRight",
  });
  // No cursor + movement key = reveal at 0,0 (doesn't move)
  assert.deepStrictEqual(action, { type: "reveal", row: 0, col: 0 });
});

test("resolveParquetKey: unknown key returns none", () => {
  const action = resolveParquetKey({ ...baseInput, key: "x" });
  assert.deepStrictEqual(action, { type: "none" });
});

test("resolveParquetKey: handles Cmd key on Mac (metaKey)", () => {
  const action = resolveParquetKey({ ...baseInput, key: "Home", metaKey: true });
  assert.deepStrictEqual(action, { type: "turn", page: 0, where: "first" });
});
