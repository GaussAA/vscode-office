import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_CHILDREN,
  MAX_DEPTH,
  buildEntryModel,
  chunkText,
  fullValueText,
  makePathKey,
  preview,
  readPathKey,
  stringSummary,
} from "@/react/view/entry/entryFormat";
import { SUMMARY_CHARS } from "@/common/recordConstants";
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

test("buildEntryModel: a scalar entry produces no rows and no wrap mode", () => {
  const model = buildEntryModel("just a string");
  assert.equal(model.nodes.length, 0);
  assert.equal(model.count, 0);
  assert.equal(model.truncated, false);
  assert.equal("wrap" in model, false, "ADR-0030 removed the wrap flag entirely");
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

test("buildEntryModel: array indices are labelled in brackets and stay addressable", () => {
  const model = buildEntryModel(["a", "b"]);
  assert.deepEqual(
    model.nodes.map((node) => node.label),
    ["[0]", "[1]"],
  );
  assert.deepEqual(model.nodes[1].path, [1]);
  // Every row is a single-line, JSON-quoted summary now.
  assert.equal(model.nodes[1].preview, '"b"');
});

test("buildEntryModel: honours a node budget and reports truncation", () => {
  const model = buildEntryModel(objectOfSize(50), { maxNodes: 10 });
  assert.equal(model.count, 10);
  assert.equal(model.truncated, true);
  assert.equal(model.nodes.length, 10);
});

test("buildEntryModel: a long string is one 120-character summary, never wrapped", () => {
  const long = "x".repeat(5_000);
  const model = buildEntryModel({ text: long });
  const [node] = model.nodes;
  assert.ok(node.preview.endsWith("(5,000 chars)"), `preview is ${node.preview.slice(-30)}`);
  assert.ok(node.preview.length <= SUMMARY_CHARS + 20, `preview is ${node.preview.length} chars`);
  // `JSON.stringify(value).slice(...)` would have allocated all 5,000 characters; the summary
  // only ever holds the window plus its marker.
});

test("buildEntryModel: a search hit moves the summary window to the match", () => {
  const value = `${"a".repeat(300)}needle${"b".repeat(300)}`;
  const plain = buildEntryModel({ text: value });
  assert.ok(plain.nodes[0].preview.startsWith('"aaa'), "without a hit the head is shown");
  const hit = buildEntryModel({ text: value }, { highlight: "needle" });
  assert.ok(hit.nodes[0].preview.startsWith('"…'), `centred summary is ${hit.nodes[0].preview}`);
  assert.ok(hit.nodes[0].preview.includes("needle"), "the hit is inside the summary");
  assert.ok(hit.nodes[0].preview.endsWith("(606 chars)"));
});

test("stringSummary: short strings are quoted, long ones carry the hidden length", () => {
  assert.equal(stringSummary("hello"), '"hello"');
  const long = stringSummary("y".repeat(200));
  assert.ok(long.startsWith('"yyy'));
  assert.ok(long.endsWith('…" (200 chars)'));
});

test("chunkText: keeps whole lines and splits lines longer than one chunk", () => {
  assert.deepEqual(chunkText(""), []);
  assert.deepEqual(chunkText("a\nb"), ["a\nb"]);
  const lines = Array.from({ length: 6 }, (_, index) => `line ${index}`);
  const chunks = chunkText(lines.join("\n"), 12);
  assert.ok(chunks.length > 1, `expected several chunks, got ${chunks.length}`);
  assert.equal(chunks.join("\n"), lines.join("\n"), "chunking must not lose characters");
  const oneLong = "z".repeat(30);
  const split = chunkText(oneLong, 8);
  assert.equal(split.length, 4);
  assert.equal(split.join(""), oneLong);
});

test("preview: strings keep the single summary number", () => {
  assert.equal(preview("short"), '"short"');
  const long = preview("q".repeat(300));
  assert.ok(long.includes("(300 chars)"));
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
  const text = fullValueText("line one\nline two", 1_000);
  assert.equal(text.text, "line one\nline two");
  assert.equal(text.truncated, false);
  assert.equal(text.chars, 17);

  const object = fullValueText({ a: 1 }, 1_000);
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

test("buildEntryModel: the overflow row has a key that cannot collide with a real path", () => {
  const model = buildEntryModel(objectOfSize(MAX_CHILDREN + 2));
  const more = model.nodes[model.nodes.length - 1];
  assert.equal(more?.overflow, 2);
  assert.throws(() => readPathKey(more?.key ?? ""));
});
