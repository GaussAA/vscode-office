import assert from "node:assert/strict";
import test from "node:test";
import {
  clearWindowedFindMemo,
  getWindowedFindMemo,
  setWindowedFindMemo,
  windowedFindMemoKey,
} from "@/react/view/excel/windowedFindMemo";

test("windowed find memo: case-folds the query", () => {
  assert.equal(windowedFindMemoKey("  Status "), "status");
  clearWindowedFindMemo();
  setWindowedFindMemo("Status", { rows: [1, 3], capped: false });
  assert.deepEqual(getWindowedFindMemo("status"), { rows: [1, 3], capped: false });
});

test("windowed find memo: keeps only the newest three queries", () => {
  clearWindowedFindMemo();
  setWindowedFindMemo("a", { rows: [1], capped: false });
  setWindowedFindMemo("b", { rows: [2], capped: false });
  setWindowedFindMemo("c", { rows: [3], capped: false });
  setWindowedFindMemo("d", { rows: [4], capped: false });
  assert.equal(getWindowedFindMemo("a"), null);
  assert.deepEqual(getWindowedFindMemo("b"), { rows: [2], capped: false });
  assert.deepEqual(getWindowedFindMemo("d"), { rows: [4], capped: false });
});

test("windowed find memo: clear removes every query", () => {
  clearWindowedFindMemo();
  setWindowedFindMemo("a", { rows: [1], capped: false });
  setWindowedFindMemo("b", { rows: [2], capped: true });
  clearWindowedFindMemo();
  assert.equal(getWindowedFindMemo("a"), null);
  assert.equal(getWindowedFindMemo("b"), null);
});
