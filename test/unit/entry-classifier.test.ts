import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyEntry, clipText, truncate, utf8ByteSize } from "../../src/service/entryClassifier";

test("utf8ByteSize: calculates byte size for ASCII text", () => {
  assert.equal(utf8ByteSize("hello"), 5);
});

test("truncate/clipText: never cut a surrogate pair in half", () => {
  const text = `${"a".repeat(39)}😀tail`;
  const cut = truncate(text, 40);
  assert.ok(cut.endsWith("…"));
  assert.ok(!/[\ud800-\udbff]$/.test(cut.slice(0, -1)), "preview ends with a lone high surrogate");
  assert.ok(!/[\ud800-\udbff]$/.test(clipText(text, 40)), "clip ends with a lone high surrogate");
  assert.equal(clipText("short", 40), "short");
});

test("utf8ByteSize: calculates byte size for UTF-8 text", () => {
  assert.equal(utf8ByteSize("你好"), 6); // 2 chars × 3 bytes each
});

test("utf8ByteSize: calculates byte size for empty string", () => {
  assert.equal(utf8ByteSize(""), 0);
});

test("classifyEntry: empty line (whitespace only)", () => {
  const result = classifyEntry("   \t  \n");
  assert.equal(result.kind, "empty");
  assert.equal(result.text, "");
  assert.equal(result.byteSize, 0);
});

test("classifyEntry: empty line (just newline)", () => {
  const result = classifyEntry("\n");
  assert.equal(result.kind, "empty");
  assert.equal(result.text, "");
  assert.equal(result.byteSize, 0);
});

test("classifyEntry: empty line (empty string)", () => {
  const result = classifyEntry("");
  assert.equal(result.kind, "empty");
  assert.equal(result.text, "");
  assert.equal(result.byteSize, 0);
});

test("classifyEntry: invalid JSON (malformed)", () => {
  const result = classifyEntry("{broken");
  assert.equal(result.kind, "invalid");
  assert.equal(result.text, "{broken");
  assert.ok(result.error);
  assert.equal(typeof result.error, "string");
});

test("classifyEntry: invalid JSON (trailing comma)", () => {
  const result = classifyEntry('{"a": 1,}');
  assert.equal(result.kind, "invalid");
  assert.equal(result.text, '{"a": 1,}');
  assert.ok(result.error);
  assert.equal(typeof result.error, "string");
});

test("classifyEntry: invalid JSON (not JSON at all)", () => {
  const result = classifyEntry("just some text");
  assert.equal(result.kind, "invalid");
  assert.equal(result.text, "just some text");
  assert.ok(result.error);
  assert.equal(typeof result.error, "string");
});

test("classifyEntry: too large to parse", () => {
  const input = "x".repeat(9_000_000); // > 8 MB default limit
  const result = classifyEntry(input);
  assert.equal(result.kind, "too-large");
  assert.equal(result.text, input);
});

test("classifyEntry: too large with custom limit", () => {
  const result = classifyEntry('{"small": "value"}', 10); // Set very low limit
  assert.equal(result.kind, "too-large");
  assert.equal(result.text, '{"small": "value"}');
});

test("classifyEntry: valid JSON object", () => {
  const result = classifyEntry('{"id": 123, "name": "test"}');
  assert.equal(result.kind, "value");
  assert.equal(result.text, '{"id": 123, "name": "test"}');
  assert.equal(result.label, "123");
  assert.ok(result.value !== undefined);
});

test("classifyEntry: valid JSON array", () => {
  const result = classifyEntry("[1, 2, 3]");
  assert.equal(result.kind, "value");
  assert.equal(result.text, "[1, 2, 3]");
  assert.ok(result.value !== undefined);
});

test("classifyEntry: valid JSON string", () => {
  const result = classifyEntry('"hello"');
  assert.equal(result.kind, "value");
  assert.equal(result.text, '"hello"');
  assert.ok(result.value !== undefined);
});

test("classifyEntry: valid JSON number", () => {
  const result = classifyEntry("42");
  assert.equal(result.kind, "value");
  assert.equal(result.text, "42");
  assert.ok(result.value !== undefined);
});

test("classifyEntry: valid JSON with label from name", () => {
  const result = classifyEntry('{"name": "Alice", "age": 30}');
  assert.equal(result.kind, "value");
  assert.equal(result.text, '{"name": "Alice", "age": 30}');
  assert.equal(result.label, "Alice");
  assert.ok(result.value !== undefined);
});

test("classifyEntry: valid JSON with nested label", () => {
  const result = classifyEntry('{"id": {"query": "search term"}, "data": {}}');
  assert.equal(result.kind, "value");
  assert.equal(result.label, "search term");
  assert.ok(result.value !== undefined);
});

test("classifyEntry: valid JSON with BOM removed", () => {
  const result = classifyEntry('\uFEFF{"id": 1}');
  assert.equal(result.kind, "value");
  assert.equal(result.text, '{"id": 1}');
  assert.equal(result.label, "1");
  assert.ok(result.value !== undefined);
});

test("classifyEntry: valid JSON with line terminators removed", () => {
  const result = classifyEntry('{"id": 2}\r\n');
  assert.equal(result.kind, "value");
  assert.equal(result.text, '{"id": 2}');
  assert.equal(result.label, "2");
  assert.ok(result.value !== undefined);
});

test("classifyEntry: valid JSON with array label", () => {
  const result = classifyEntry('{"query_search": ["find this"]}');
  assert.equal(result.kind, "value");
  assert.equal(result.label, "find this");
  assert.ok(result.value !== undefined);
});

test("classifyEntry: handles Unicode correctly", () => {
  const input = '{"name": "你好"}';
  const result = classifyEntry(input);

  assert.equal(result.kind, "value");
  assert.equal(result.label, "你好");
  assert.ok(result.byteSize > input.length, "UTF-8 bytes > char count");
});

test("classifyEntry: handles null value", () => {
  const result = classifyEntry("null");

  assert.equal(result.kind, "value");
  assert.equal(result.value, null);
});

test("classifyEntry: handles boolean values", () => {
  const trueResult = classifyEntry("true");
  const falseResult = classifyEntry("false");

  assert.equal(trueResult.kind, "value");
  assert.equal(trueResult.value, true);
  assert.equal(falseResult.kind, "value");
  assert.equal(falseResult.value, false);
});

test("classifyEntry: derives label from various key priorities", () => {
  const testCases = [
    { input: '{"id": "a", "name": "b"}', expected: "a" },
    { input: '{"name": "b", "title": "c"}', expected: "b" },
    { input: '{"key": "d", "title": "c"}', expected: "d" }, // key comes before title
    { input: '{"uuid": "e"}', expected: "e" },
    { input: '{"_id": "f"}', expected: "f" },
  ];

  for (const tc of testCases) {
    const result = classifyEntry(tc.input);
    assert.equal(result.label, tc.expected, `label mismatch for ${tc.input}`);
  }
});

test("classifyEntry: handles label truncation", () => {
  const longName = "x".repeat(100);
  const input = `{"name": "${longName}"}`;
  const result = classifyEntry(input);

  assert.equal(result.kind, "value");
  assert.ok(result.label, "should have a label");
  assert.ok(result.label!.length <= 41, "label should be truncated"); // 40 chars + ellipsis
});

test("classifyEntry: returns no label for non-record values", () => {
  const testCases = ["[]", "123", '"string"', "true", "null"];

  for (const input of testCases) {
    const result = classifyEntry(input);
    assert.equal(result.kind, "value");
    assert.equal(result.label, undefined, `should have no label for ${input}`);
  }
});

test("classifyEntry: byteSize is always calculated", () => {
  const testCases = ["", "   ", '{"a":1}', "invalid", "null"];

  for (const input of testCases) {
    const result = classifyEntry(input);
    assert.equal(typeof result.byteSize, "number", "byteSize should always be a number");
    assert.ok(result.byteSize >= 0, "byteSize should be non-negative");
  }
});
