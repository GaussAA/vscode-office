import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_CHILDREN,
  MAX_DEPTH,
  buildEntryModel,
  countNodes,
  makePathKey,
} from "@/react/view/jsonl/jsonlFormat";
import { highlightRuns } from "@/react/common/highlight";

const objectOfSize = (size: number): Record<string, number> =>
  Object.fromEntries(Array.from({ length: size }, (_, index) => [`key_${index}`, index]));

interface ChainNode {
  children?: ChainNode[];
}

function maxDepth(nodes: ChainNode[], depth = 1): number {
  let deepest = depth;
  for (const node of nodes) {
    if (!node.children?.length) continue;
    deepest = Math.max(deepest, maxDepth(node.children, depth + 1));
  }
  return deepest;
}

test("countNodes: exactly the limit still fits, one more does not", () => {
  assert.equal(countNodes(objectOfSize(500)), 500);
  // Regression: returning exactly `limit` here made a 501-node entry look wrappable.
  assert.equal(
    countNodes(objectOfSize(501)),
    501,
    "crossing the cap must be reported as limit + 1",
  );
});

test("countNodes: stops descending at MAX_DEPTH", () => {
  // A chain deeper than MAX_DEPTH can never produce a node beyond MAX_DEPTH - 1.
  let chain: Record<string, unknown> = { leaf: 1 };
  for (let depth = 0; depth < MAX_DEPTH + 5; depth++) chain = { child: chain };
  assert.ok(countNodes(chain) <= MAX_DEPTH);
});

test('buildEntryModel: caps children and appends a non-selectable "more keys" row', () => {
  const model = buildEntryModel(objectOfSize(MAX_CHILDREN + 20));
  assert.equal(model.count, MAX_CHILDREN);
  assert.equal(model.nodes.length, MAX_CHILDREN + 1);
  const more = model.nodes[model.nodes.length - 1];
  assert.equal(more.overflow, 20);
  assert.equal(more.composite, false);
  assert.equal(more.children.length, 0);
});

test("buildEntryModel: keeps the tree inside MAX_DEPTH", () => {
  let chain: Record<string, unknown> = { leaf: 1 };
  for (let depth = 0; depth < MAX_DEPTH + 5; depth++) chain = { child: chain };
  const model = buildEntryModel(chain);
  assert.ok(model.count > 0);
  // walk() stops once the path reaches MAX_DEPTH, so the deepest node sits AT that depth.
  assert.equal(maxDepth(model.nodes), MAX_DEPTH);
  assert.ok(model.count <= MAX_DEPTH);
  assert.equal(model.keys.length, model.count);
});

test("buildEntryModel: a scalar entry produces no rows", () => {
  const model = buildEntryModel("just a string");
  assert.equal(model.nodes.length, 0);
  assert.equal(model.count, 0);
  assert.equal(model.truncated, false);
  assert.equal(model.wrap, false, "a scalar has nothing to wrap");
});

test("buildEntryModel: shallowKeys stop at the default expand depth", () => {
  const model = buildEntryModel({ a: { b: { c: { d: { e: 1 } } } } });
  // Keys are JSON arrays (makePathKey), not dotted paths.
  assert.equal(model.shallowKeys.length, 2);
  assert.ok(model.shallowKeys.includes(makePathKey(["a"])));
  assert.ok(!model.shallowKeys.includes(makePathKey(["a", "b", "c"])));
});

test("buildEntryModel: decides wrapping itself, in the same walk that builds the tree", () => {
  // Small entries wrap (variable row height); big ones would freeze a virtual list.
  const small = buildEntryModel({ a: 1, b: "two" });
  assert.equal(small.wrap, true);

  const big = buildEntryModel(objectOfSize(600));
  assert.equal(big.wrap, false);

  // The boundary is inclusive: exactly `wrapNodeLimit` nodes still wrap.
  const atLimit = buildEntryModel(objectOfSize(500));
  assert.equal(atLimit.wrap, true);
  assert.equal(buildEntryModel(objectOfSize(501)).wrap, false);
});

test("buildEntryModel: wrap mode cuts very long strings, single-line mode does not", () => {
  const long = "x".repeat(5000);
  const wrapped = buildEntryModel({ text: long });
  assert.ok(wrapped.nodes[0].preview.endsWith("chars)"), "wrap mode appends the original length");
  assert.ok(wrapped.nodes[0].preview.length < long.length);

  const nodes = buildEntryModel({ text: long }, { maxChildren: 10, wrapNodeLimit: 0 });
  assert.equal(nodes.wrap, false);
});

test("buildEntryModel: array indices are labelled in brackets and stay addressable", () => {
  const model = buildEntryModel(["a", "b"]);
  assert.deepEqual(
    model.nodes.map((node) => node.label),
    ["[0]", "[1]"],
  );
  assert.deepEqual(model.nodes[1].path, [1]);
  // In wrap mode a string preview is the raw text, not a JSON-quoted literal.
  assert.equal(model.nodes[1].preview, "b");
});

test("buildEntryModel: honours a node budget and reports truncation", () => {
  const model = buildEntryModel(objectOfSize(50), { maxNodes: 10 });
  assert.equal(model.count, 10);
  assert.equal(model.truncated, true);
  assert.equal(model.nodes.length, 10);
});

test("highlightRuns: splits only the matched runs and is case-insensitive", () => {
  const parts = highlightRuns("Alpha alPHA omega", "alpha");
  assert.equal(parts.filter((part) => part.hit).length, 2);
  assert.equal(parts.map((part) => part.text).join(""), "Alpha alPHA omega");
  assert.deepEqual(highlightRuns("plain", ""), [{ text: "plain", hit: false }]);
});

test("highlightRuns: caps the number of runs on pathological input", () => {
  const parts = highlightRuns("a".repeat(500), "a");
  assert.ok(parts.length <= 41, `produced ${parts.length} runs`);
  assert.equal(parts.map((part) => part.text).join("").length, 500);
});
