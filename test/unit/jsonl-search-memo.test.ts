import assert from "node:assert/strict";
import test from "node:test";
import type { JsonlEntrySummary } from "@/common/jsonlTypes";
import {
  JsonlSearchMemo,
  jsonlSearchMemoKey,
  type JsonlSearchSnapshot,
} from "@/react/view/jsonl/jsonlSearchMemo";

function snapshot(index: number): JsonlSearchSnapshot {
  const entry = { index, size: 5, raw: `{"i":${index}}`, kind: "value", label: String(index) };
  return {
    entries: [entry as unknown as JsonlEntrySummary],
    meta: { matches: 1, scanned: 10, total: 10, done: true, capped: false },
  };
}

test("jsonl search memo: case-folds the query", () => {
  assert.equal(jsonlSearchMemoKey("  Status "), "status");
  const memo = new JsonlSearchMemo();
  memo.set("Status", snapshot(1));
  assert.equal(memo.get("status")?.entries[0]?.index, 1);
});

test("jsonl search memo: keeps only the newest three queries", () => {
  const memo = new JsonlSearchMemo();
  memo.set("a", snapshot(1));
  memo.set("b", snapshot(2));
  memo.set("c", snapshot(3));
  memo.set("d", snapshot(4));

  assert.equal(memo.get("a"), null);
  assert.equal(memo.get("b")?.entries[0]?.index, 2);
  assert.equal(memo.get("c")?.entries[0]?.index, 3);
  assert.equal(memo.get("d")?.entries[0]?.index, 4);
});

test("jsonl search memo: re-inserting a query refreshes its position", () => {
  const memo = new JsonlSearchMemo();
  memo.set("a", snapshot(1));
  memo.set("b", snapshot(2));
  memo.set("c", snapshot(3));
  memo.set("a", snapshot(11));
  memo.set("d", snapshot(4));

  assert.equal(memo.get("a")?.entries[0]?.index, 11);
  assert.equal(memo.get("b"), null);
  assert.equal(memo.get("c")?.entries[0]?.index, 3);
  assert.equal(memo.get("d")?.entries[0]?.index, 4);
});

test("jsonl search memo: clear removes every query", () => {
  const memo = new JsonlSearchMemo();
  memo.set("a", snapshot(1));
  memo.set("b", snapshot(2));
  memo.clear();
  assert.equal(memo.get("a"), null);
  assert.equal(memo.get("b"), null);
});
