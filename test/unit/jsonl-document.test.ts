import assert from "node:assert/strict";
import test from "node:test";
import {
  buildJsonlEntry,
  buildJsonlIndex,
  buildJsonlSummary,
  deriveLabel,
  matchSnippet,
  readJsonlLineText,
} from "@/service/jsonlDocument";

const encoder = new TextEncoder();

function open(text: string) {
  const bytes = encoder.encode(text);
  return { bytes, index: buildJsonlIndex(bytes) };
}

test("index: splits lines and treats a trailing newline as a terminator", () => {
  const plain = open("a\nb\nc");
  assert.equal(plain.index.lineCount, 3);
  assert.equal(readJsonlLineText(plain.bytes, plain.index, 0).text, "a");
  assert.equal(readJsonlLineText(plain.bytes, plain.index, 2).text, "c");

  const trailing = open("a\nb\n");
  // 'a' and 'b' only: the final newline terminates the last line, it does not start a new one.
  assert.equal(trailing.index.lineCount, 2);
  assert.equal(readJsonlLineText(trailing.bytes, trailing.index, 1).text, "b");
});

test("index: an empty file still exposes one line", () => {
  const empty = open("");
  assert.equal(empty.index.lineCount, 1);
  assert.equal(readJsonlLineText(empty.bytes, empty.index, 0).text, "");
});

test("read: strips a UTF-8 BOM from the first line", () => {
  const bom = open('\uFEFF{"a":1}\n{"b":2}\n');
  assert.equal(readJsonlLineText(bom.bytes, bom.index, 0).text, '{"a":1}');
  assert.equal(readJsonlLineText(bom.bytes, bom.index, 1).text, '{"b":2}');
});

test("read: strips a CRLF terminator from the decoded text", () => {
  const crlf = open('{"a":1}\r\n{"b":2}\n');
  assert.equal(crlf.index.lineCount, 2);
  assert.equal(readJsonlLineText(crlf.bytes, crlf.index, 0).text, '{"a":1}');
  assert.equal(readJsonlLineText(crlf.bytes, crlf.index, 1).text, '{"b":2}');
});

test("label: derives identity from configured top-level keys only", () => {
  assert.equal(deriveLabel({ id: 42 }), "42");
  assert.equal(deriveLabel({ name: "  alpha  " }), "alpha");
  assert.equal(deriveLabel({ _id: "abc123" }), "abc123");
  assert.equal(deriveLabel({ timestamp: 1700000000 }), "1700000000");
  assert.equal(deriveLabel({ nested: { id: 1 } }), undefined, "nested ids are not identity");
  assert.equal(deriveLabel({ id: {}, name: "beta" }), "beta", "an unusable key falls through");
  assert.equal(deriveLabel("scalar"), undefined);
});

test("label: truncates long values to 40 characters plus an ellipsis", () => {
  const label = deriveLabel({ name: "x".repeat(60) });
  assert.ok(label, "a name yields a label");
  assert.equal(label.length, 41);
  assert.ok(label.endsWith("…"));
});

test("snippet: keeps short text intact and marks a window in long text", () => {
  assert.equal(matchSnippet("abcdefghij", "def"), "abcdefghij");
  assert.equal(matchSnippet("no hit here", "zzz"), undefined);

  const long = `${"x".repeat(100)}needle${"y".repeat(100)}`;
  const snippet = matchSnippet(long, "needle", 5);
  assert.ok(snippet, "a hit returns a snippet");
  assert.ok(snippet.startsWith("…"), "text before the window is elided");
  assert.ok(snippet.endsWith("…"), "text after the window is elided");
  assert.ok(snippet.includes("needle"));
  assert.equal(snippet.length, 2 + 5 + 6 + 5, "caller radius is honoured");
});

test("snippet: matching is case-insensitive against the text", () => {
  const text = "ABC".repeat(40) + "NEEDLE";
  const snippet = matchSnippet(text, "needle", 3);
  assert.ok(snippet, "a hit returns a snippet");
  assert.ok(snippet.includes("NEEDLE"));
  assert.ok(snippet.startsWith("…"));
});

test("classify: a line is exactly one of four kinds", () => {
  const { bytes, index } = open(
    ['{"id":1,"name":"alpha"}', "", "not json", `{"big":"${"x".repeat(1024 * 1024 + 1)}"}`].join(
      "\n",
    ),
  );

  const kinds = [0, 1, 2, 3].map((line) => buildJsonlSummary(bytes, index, line).kind);
  assert.deepEqual(kinds, ["value", "empty", "invalid", "too-large"]);
});

test("classify: the summary carries the identity label, not the value", () => {
  const { bytes, index } = open('{"id":42,"nested":{"id":1}}');
  const summary = buildJsonlSummary(bytes, index, 0);
  assert.equal(summary.kind, "value");
  assert.equal(summary.label, "42");
  // A summary deliberately has no `value` field; the cast is what lets us assert the absence.
  assert.equal(
    (summary as { value?: unknown }).value,
    undefined,
    "the directory must not keep parsed values",
  );
});

test("detail: every kind carries the text the raw view needs", () => {
  const { bytes, index } = open('{"id":7}\n\n[1,2]');

  const value = buildJsonlEntry(bytes, index, 0);
  assert.equal(value.kind, "value");
  assert.equal(value.label, "7");
  assert.deepEqual(value.value, { id: 7 });
  assert.equal(value.text, '{"id":7}');

  const empty = buildJsonlEntry(bytes, index, 1);
  assert.equal(empty.kind, "empty");
  assert.equal(empty.text, "");

  const arrayLine = buildJsonlEntry(bytes, index, 2);
  assert.equal(arrayLine.kind, "value");
  assert.deepEqual(arrayLine.value, [1, 2]);
  assert.equal(arrayLine.label, undefined);
});

test("detail: an invalid line keeps its parse error and its text", () => {
  const { bytes, index } = open('{"id":1,}');
  const entry = buildJsonlEntry(bytes, index, 0);
  assert.equal(entry.kind, "invalid");
  assert.ok(entry.error.length > 0);
  assert.equal(entry.text, '{"id":1,}');
});
