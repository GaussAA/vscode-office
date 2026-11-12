import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyWindowReply,
  emptyDirectoryWindow,
  recenterWindow,
  windowNeedsMore,
} from "../../src/react/view/jsonl/directoryWindow";

test("directory window: recenter keeps the target inside the window", () => {
  assert.deepEqual(recenterWindow(900, 10_000, 500), { start: 800, end: 1300 });
  assert.deepEqual(recenterWindow(9_900, 10_000, 500), { start: 9_500, end: 10_000 });
  assert.deepEqual(recenterWindow(3, 10, 500), { start: 0, end: 10 });
});

test("directory window: a newest replace replaces the window; a stale replace is ignored", () => {
  const initial = emptyDirectoryWindow<string>();
  const replaced = applyWindowReply(initial, { start: 200, items: ["a", "b"] }, "replace", true);
  assert.deepEqual(replaced, { start: 200, end: 202, items: ["a", "b"] });
  assert.equal(
    applyWindowReply(replaced, { start: 400, items: ["c"] }, "replace", false),
    replaced,
  );
});

test("directory window: append only extends a contiguous end", () => {
  const state = { start: 100, end: 102, items: ["a", "b"] };
  assert.deepEqual(applyWindowReply(state, { start: 102, items: ["c", "d"] }, "append", false), {
    start: 100,
    end: 104,
    items: ["a", "b", "c", "d"],
  });
  assert.equal(applyWindowReply(state, { start: 105, items: ["gap"] }, "append", false), state);
});

test("directory window: empty replies and needsMore are explicit no-ops", () => {
  const state = { start: 0, end: 2, items: ["a", "b"] };
  assert.equal(applyWindowReply(state, { start: 2, items: [] }, "append", true), state);
  assert.equal(windowNeedsMore(state, 4), true);
  assert.equal(windowNeedsMore(state, 2), false);
});
