import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_CHILDREN,
  MAX_DEPTH,
  buildEntryModel,
  countNodes,
  readPathKey,
  WRAP_NODE_LIMIT,
  fullValueText,
  makePathKey,
} from "@/react/view/entry/entryFormat";
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
  assert.equal(countNodes(objectOfSize(WRAP_NODE_LIMIT)), WRAP_NODE_LIMIT);
  // Regression: returning exactly `limit` here made one-more-node entries look wrappable.
  assert.equal(
    countNodes(objectOfSize(WRAP_NODE_LIMIT + 1)),
    WRAP_NODE_LIMIT + 1,
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

test("buildEntryModel: a node at the depth cap is a leaf that counts its hidden keys", () => {
  let chain: Record<string, unknown> = { leafA: 1, leafB: 2 };
  for (let depth = 0; depth < MAX_DEPTH + 3; depth++) chain = { child: chain };
  const model = buildEntryModel(chain);
  let node = model.nodes[0];
  let depth = 1;
  while (node.children.length > 0) {
    node = node.children[0];
    depth++;
  }
  assert.equal(depth, MAX_DEPTH);
  assert.equal(node.composite, false, "the capped node must not advertise an expand arrow");
  assert.ok((node.depthCapped ?? 0) > 0, "the capped node must say how many keys are hidden");
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

  const big = buildEntryModel(objectOfSize(WRAP_NODE_LIMIT + 1));
  assert.equal(big.wrap, false);

  // The boundary is inclusive: exactly `wrapNodeLimit` nodes still wrap.
  const atLimit = buildEntryModel(objectOfSize(WRAP_NODE_LIMIT));
  assert.equal(atLimit.wrap, true);
  assert.equal(buildEntryModel(objectOfSize(WRAP_NODE_LIMIT + 1)).wrap, false);
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

test("model: the node cap is reported so the tree can say it was cut", () => {
  const model = buildEntryModel(objectOfSize(50), { maxNodes: 10 });
  assert.equal(model.truncated, true);
  assert.equal(model.limit, 10);

  const whole = buildEntryModel(objectOfSize(50));
  assert.equal(whole.truncated, false);
  assert.equal(whole.limit, 20000);
});

test("fullValueText: strings are read as text, everything else as pretty JSON", () => {
  const text = fullValueText("line one\nline two");
  assert.equal(text.text, "line one\nline two");
  assert.equal(text.truncated, false);
  assert.equal(text.chars, 17);

  const object = fullValueText({ a: 1 });
  assert.equal(object.text, '{\n  "a": 1\n}');
});

test("fullValueText: a cap is reported, and Copy still has the whole value", () => {
  const value = "x".repeat(50);
  const cut = fullValueText(value, 10);
  assert.equal(cut.text.length, 10);
  assert.equal(cut.chars, 50);
  assert.equal(cut.truncated, true);
  assert.ok(!cut.text.endsWith("…"), "the notice owns the message, not a suffix");

  const fits = fullValueText(value, 50);
  assert.equal(fits.truncated, false);
  assert.equal(fits.text, value);
});

test("countNodes: honours a caller-supplied depth cap", () => {
  const chain = { a: { b: { c: { d: { e: 1 } } } } };
  assert.ok(countNodes(chain, 100, 2) <= 2);
});

test("buildEntryModel: the overflow row has a key that cannot collide with a real path", () => {
  const model = buildEntryModel(objectOfSize(MAX_CHILDREN + 2));
  const more = model.nodes[model.nodes.length - 1];
  assert.equal(more?.overflow, 2);
  assert.throws(() => readPathKey(more?.key ?? ""));
});
