import assert from "node:assert/strict";
import test from "node:test";
import { ParquetHitSet } from "@/react/view/parquet/parquetHitSet";
import { ParquetSearchMemo } from "@/react/view/parquet/parquetSearchMemo";

function entry(query: string): { hitSet: ParquetHitSet; capped: boolean } {
  return { hitSet: new ParquetHitSet([1, 2], [0, 1], query), capped: false };
}

test("search memo: returns the hit set for a normalized query", () => {
  const memo = new ParquetSearchMemo();
  const result = entry("foo");
  memo.set("foo", result);
  assert.equal(memo.get("foo"), result);
  assert.equal(memo.get("bar"), undefined);
});

test("search memo: keeps the most recently used three queries", () => {
  const memo = new ParquetSearchMemo(3);
  memo.set("a", entry("a"));
  memo.set("b", entry("b"));
  memo.set("c", entry("c"));

  // Touch A so B becomes the oldest.
  assert.ok(memo.get("a"));
  memo.set("d", entry("d"));

  assert.equal(memo.get("b"), undefined, "B should have been evicted");
  assert.ok(memo.get("a"));
  assert.ok(memo.get("c"));
  assert.ok(memo.get("d"));
  assert.equal(memo.size, 3);
});

test("search memo: setting an existing query replaces it without growing", () => {
  const memo = new ParquetSearchMemo(2);
  memo.set("a", entry("a"));
  const replacement = entry("a");
  memo.set("a", replacement);
  assert.equal(memo.get("a"), replacement);
  assert.equal(memo.size, 1);
});

test("search memo: clear drops every query", () => {
  const memo = new ParquetSearchMemo();
  memo.set("a", entry("a"));
  memo.set("b", entry("b"));
  memo.clear();
  assert.equal(memo.size, 0);
  assert.equal(memo.get("a"), undefined);
});
