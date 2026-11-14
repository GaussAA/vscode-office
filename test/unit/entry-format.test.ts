import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isComposite,
  typeLabel,
  typeClass,
  preview,
  formatBytes,
  pathToText,
  makePathKey,
  readPathKey,
  countNodes,
  buildEntryModel,
  valueAtPath,
  jsonText,
  fullValueText,
} from "../../src/react/view/entry/entryFormat.ts";

// ===== Type Checking =====

test("isComposite: identifies objects as composite", () => {
  assert.strictEqual(isComposite({ a: 1 }), true);
  assert.strictEqual(isComposite({}), true);
});

test("isComposite: identifies arrays as composite", () => {
  assert.strictEqual(isComposite([1, 2, 3]), true);
  assert.strictEqual(isComposite([]), true);
});

test("isComposite: identifies primitives as non-composite", () => {
  assert.strictEqual(isComposite(null), false);
  assert.strictEqual(isComposite(42), false);
  assert.strictEqual(isComposite("string"), false);
  assert.strictEqual(isComposite(true), false);
  assert.strictEqual(isComposite(undefined), false);
});

// ===== Type Labels =====

test("typeLabel: formats null", () => {
  assert.strictEqual(typeLabel(null), "null");
});

test("typeLabel: formats arrays with length", () => {
  assert.strictEqual(typeLabel([1, 2, 3]), "array[3]");
  assert.strictEqual(typeLabel([]), "array[0]");
});

test("typeLabel: formats objects with key count", () => {
  assert.strictEqual(typeLabel({ a: 1, b: 2 }), "object{2}");
  assert.strictEqual(typeLabel({}), "object{0}");
});

test("typeLabel: formats primitives by type", () => {
  assert.strictEqual(typeLabel(42), "number");
  assert.strictEqual(typeLabel("text"), "string");
  assert.strictEqual(typeLabel(true), "boolean");
});

// ===== Type Classes =====

test("typeClass: returns correct CSS classes", () => {
  assert.strictEqual(typeClass(null), "null");
  assert.strictEqual(typeClass([]), "array");
  assert.strictEqual(typeClass({}), "object");
  assert.strictEqual(typeClass(42), "number");
  assert.strictEqual(typeClass("text"), "string");
  assert.strictEqual(typeClass(true), "boolean");
});

// ===== Preview =====

test("preview: shows null", () => {
  assert.strictEqual(preview(null), "null");
});

test("preview: shows composite placeholders", () => {
  assert.strictEqual(preview([1, 2]), "[…]");
  assert.strictEqual(preview({ a: 1 }), "{…}");
});

test("preview: shows quoted strings", () => {
  assert.strictEqual(preview("hello"), '"hello"');
});

test("preview: truncates long strings", () => {
  const long = "x".repeat(150);
  const result = preview(long);
  assert(result.endsWith("…"));
  assert(result.length < long.length + 10);
});

test("preview: shows bigint with 'n' suffix", () => {
  assert.strictEqual(preview(42n), "42n");
});

test("preview: shows numbers and booleans", () => {
  assert.strictEqual(preview(42), "42");
  assert.strictEqual(preview(true), "true");
});

// ===== Byte Formatting =====

test("formatBytes: formats bytes", () => {
  assert.strictEqual(formatBytes(500), "500 B");
  assert.strictEqual(formatBytes(1023), "1023 B");
});

test("formatBytes: formats kilobytes", () => {
  assert.strictEqual(formatBytes(1024), "1.0 KB");
  assert.strictEqual(formatBytes(1536), "1.5 KB");
});

test("formatBytes: formats megabytes", () => {
  assert.strictEqual(formatBytes(1024 * 1024), "1.0 MB");
  assert.strictEqual(formatBytes(1024 * 1024 * 2.5), "2.5 MB");
});

test("formatBytes: formats gigabytes", () => {
  assert.strictEqual(formatBytes(1024 * 1024 * 1024), "1.00 GB");
  assert.strictEqual(formatBytes(1024 * 1024 * 1024 * 3.14), "3.14 GB");
});

// ===== Path Handling =====

test("pathToText: converts simple path", () => {
  assert.strictEqual(pathToText(["a", "b", "c"]), "a.b.c");
});

test("pathToText: converts path with array indices", () => {
  assert.strictEqual(pathToText(["users", 0, "name"]), "users[0].name");
});

test("pathToText: handles empty path", () => {
  assert.strictEqual(pathToText([]), "");
});

test("pathToText: handles mixed path", () => {
  assert.strictEqual(pathToText(["data", 0, "items", 1, "value"]), "data[0].items[1].value");
});

test("makePathKey and readPathKey: round-trip simple path", () => {
  const path = ["a", "b", "c"];
  const key = makePathKey(path);
  assert.deepStrictEqual(readPathKey(key), path);
});

test("makePathKey and readPathKey: round-trip path with indices", () => {
  const path = ["users", 0, "name"];
  const key = makePathKey(path);
  assert.deepStrictEqual(readPathKey(key), path);
});

// ===== Node Counting =====

test("countNodes: counts flat object", () => {
  const obj = { a: 1, b: 2, c: 3 };
  assert.strictEqual(countNodes(obj), 3);
});

test("countNodes: counts nested structure", () => {
  const obj = { a: { b: { c: 1 } } };
  assert.strictEqual(countNodes(obj), 3);
});

test("countNodes: respects limit", () => {
  const large = { a: 1, b: 2, c: 3, d: 4, e: 5 };
  const count = countNodes(large, 3);
  assert.strictEqual(count, 4); // limit + 1 to indicate capped
});

test("countNodes: handles arrays", () => {
  const arr = [1, 2, [3, 4, 5]];
  assert.strictEqual(countNodes(arr), 6); // 3 top + 3 nested
});

test("countNodes: respects max depth", () => {
  const deep = { a: { b: { c: { d: 1 } } } };
  const count = countNodes(deep, 100, 2);
  assert(count <= 2); // Stops at depth 2
});

// ===== Value at Path =====

test("valueAtPath: retrieves nested value", () => {
  const obj = { a: { b: { c: 42 } } };
  assert.strictEqual(valueAtPath(obj, ["a", "b", "c"]), 42);
});

test("valueAtPath: retrieves array element", () => {
  const obj = { items: [10, 20, 30] };
  assert.strictEqual(valueAtPath(obj, ["items", 1]), 20);
});

test("valueAtPath: returns undefined for invalid path", () => {
  const obj = { a: 1 };
  assert.strictEqual(valueAtPath(obj, ["b", "c"]), undefined);
});

test("valueAtPath: handles empty path", () => {
  const obj = { a: 1 };
  assert.deepStrictEqual(valueAtPath(obj, []), obj);
});

// ===== JSON Text =====

test("jsonText: returns string as-is", () => {
  assert.strictEqual(jsonText("hello"), "hello");
});

test("jsonText: stringifies objects", () => {
  const obj = { a: 1, b: 2 };
  const result = jsonText(obj);
  assert(result.includes('"a"'));
  assert(result.includes('"b"'));
});

test("jsonText: handles circular references gracefully", () => {
  const obj: any = { a: 1 };
  obj.self = obj;
  const result = jsonText(obj);
  assert.strictEqual(typeof result, "string");
});

// ===== Full Value Text =====

test("fullValueText: returns complete text under limit", () => {
  const result = fullValueText("short");
  assert.strictEqual(result.text, "short");
  assert.strictEqual(result.chars, 5);
  assert.strictEqual(result.truncated, false);
});

test("fullValueText: truncates long text", () => {
  const long = "x".repeat(100000);
  const result = fullValueText(long, 1000);
  assert.strictEqual(result.text.length, 1000);
  assert.strictEqual(result.chars, 100000);
  assert.strictEqual(result.truncated, true);
});

test("fullValueText: stringifies objects", () => {
  const obj = { a: 1 };
  const result = fullValueText(obj);
  assert(result.text.includes('"a"'));
  assert.strictEqual(result.truncated, false);
});

// ===== Build Entry Model =====

test("buildEntryModel: builds simple object tree", () => {
  const obj = { a: 1, b: "test" };
  const model = buildEntryModel(obj);
  assert.strictEqual(model.nodes.length, 2);
  assert.strictEqual(model.count, 2);
  assert.strictEqual(model.truncated, false);
});

test("buildEntryModel: builds array tree", () => {
  const arr = [1, 2, 3];
  const model = buildEntryModel(arr);
  assert.strictEqual(model.nodes.length, 3);
  assert.strictEqual(model.count, 3);
});

test("buildEntryModel: respects max children", () => {
  const obj = { a: 1, b: 2, c: 3, d: 4, e: 5 };
  const model = buildEntryModel(obj, { maxChildren: 3 });
  assert.strictEqual(model.nodes.length, 4); // 3 items + 1 overflow node
  assert(model.nodes[3].overflow !== undefined);
});

test("buildEntryModel: respects max depth", () => {
  const deep = { a: { b: { c: 1 } } };
  const model = buildEntryModel(deep, { maxDepth: 2 });
  assert.strictEqual(model.nodes.length, 1); // Only 'a'
  assert.strictEqual(model.nodes[0].children.length, 1); // Only 'b'
  assert(model.nodes[0].children[0].depthCapped !== undefined);
});

test("buildEntryModel: marks truncation at max nodes", () => {
  const large = { a: 1, b: 2, c: 3, d: 4, e: 5 };
  const model = buildEntryModel(large, { maxNodes: 3 });
  assert.strictEqual(model.truncated, true);
  assert.strictEqual(model.count, 3);
});

test("buildEntryModel: includes all keys", () => {
  const obj = { a: { b: 1 }, c: 2 };
  const model = buildEntryModel(obj);
  assert(model.keys.length >= 3); // a, a.b, c
});
