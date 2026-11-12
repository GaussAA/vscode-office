import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveParquetKey } from "../../src/react/view/parquet/parquetKeymap";

const base = {
  ctrlKey: false,
  metaKey: false,
  cursor: { row: 0, col: 0 },
  rows: 50,
  cols: 4,
  page: 2,
  pageCount: 10,
  visibleRows: 20,
  hasCopy: true,
};

test("parquet keymap: escape, enter and copy are commands, not navigation", () => {
  assert.deepEqual(resolveParquetKey({ ...base, key: "Escape" }), { type: "escape" });
  assert.deepEqual(resolveParquetKey({ ...base, key: "Enter" }), { type: "inspect" });
  assert.deepEqual(resolveParquetKey({ ...base, key: "c", ctrlKey: true }), { type: "copy" });
  assert.deepEqual(resolveParquetKey({ ...base, key: "c", ctrlKey: true, hasCopy: false }), {
    type: "none",
  });
});

test("parquet keymap: page-sized moves stay on the page when they can", () => {
  assert.deepEqual(resolveParquetKey({ ...base, key: "PageDown", cursor: { row: 2, col: 1 } }), {
    type: "reveal",
    row: 22,
    col: 1,
  });
  assert.deepEqual(resolveParquetKey({ ...base, key: "PageUp", cursor: { row: 30, col: 1 } }), {
    type: "reveal",
    row: 10,
    col: 1,
  });
});

test("parquet keymap: page edges turn the page and land on the edge", () => {
  assert.deepEqual(resolveParquetKey({ ...base, key: "PageDown", cursor: { row: 35, col: 1 } }), {
    type: "turn",
    page: 3,
    where: "first",
  });
  assert.deepEqual(resolveParquetKey({ ...base, key: "PageUp", cursor: { row: 5, col: 1 } }), {
    type: "turn",
    page: 1,
    where: "last",
  });
  assert.deepEqual(resolveParquetKey({ ...base, key: "ArrowDown", cursor: { row: 49, col: 2 } }), {
    type: "turn",
    page: 3,
    where: "first",
  });
  assert.deepEqual(resolveParquetKey({ ...base, key: "ArrowUp", cursor: { row: 0, col: 2 } }), {
    type: "turn",
    page: 1,
    where: "last",
  });
});

test("parquet keymap: ctrl+home/end go to the page edges", () => {
  assert.deepEqual(resolveParquetKey({ ...base, key: "Home", ctrlKey: true }), {
    type: "turn",
    page: 0,
    where: "first",
  });
  assert.deepEqual(resolveParquetKey({ ...base, key: "End", metaKey: true }), {
    type: "turn",
    page: 9,
    where: "last",
  });
});

test("parquet keymap: arrows clamp and home/end jump columns; cold start only on navigation", () => {
  assert.deepEqual(resolveParquetKey({ ...base, key: "ArrowLeft", cursor: { row: 1, col: 0 } }), {
    type: "reveal",
    row: 1,
    col: 0,
  });
  assert.deepEqual(resolveParquetKey({ ...base, key: "End", cursor: { row: 1, col: 0 } }), {
    type: "reveal",
    row: 1,
    col: 3,
  });
  assert.deepEqual(resolveParquetKey({ ...base, key: "ArrowDown", cursor: null }), {
    type: "reveal",
    row: 0,
    col: 0,
  });
  assert.deepEqual(resolveParquetKey({ ...base, key: "a", cursor: null }), { type: "none" });
});
