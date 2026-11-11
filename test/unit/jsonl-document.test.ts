import assert from "node:assert/strict";
import test from "node:test";
import { JSONL_MAX_LINE_BYTES, JSONL_MAX_TEXT_CHARS } from "@/common/jsonlTypes";
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

test("label: a top-level identity object is read one level deep", () => {
  // Agent transcripts commonly store `id: { query, ... }`. Reading that one level is what
  // keeps the directory from becoming a wall of identical raw JSON lines.
  assert.equal(deriveLabel({ id: { query: "  hello  " } }), "hello");
  assert.equal(deriveLabel({ id: { name: "alpha", query: "beta" } }), "beta");
  assert.equal(deriveLabel({ id: { query: 42 } }), "42");
  assert.equal(
    deriveLabel({ id: { ori_level_1_task: "category" } }),
    undefined,
    "only the documented nested identity keys are read",
  );
  assert.equal(
    deriveLabel({ id: {}, name: "beta" }),
    "beta",
    "an empty identity object falls through",
  );
  assert.equal(deriveLabel({ id: [] }), undefined, "an array is not an identity container");
  // A child record's id is still not this entry's identity.
  assert.equal(deriveLabel({ nested: { id: { query: "child" } } }), undefined);
  // A one-element string array is a common transcript identity; arrays of records are not.
  assert.equal(deriveLabel({ query_search: ["  a search query  "] }), "a search query");
  assert.equal(deriveLabel({ query_search: [{ id: 1 }] }), undefined);
  assert.equal(deriveLabel({ query_search: [] }), undefined);
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
    [
      '{"id":1,"name":"alpha"}',
      "",
      "not json",
      `{"big":"${"x".repeat(JSONL_MAX_LINE_BYTES)}"}`,
    ].join("\n"),
  );

  const kinds = [0, 1, 2, 3].map((line) => buildJsonlSummary(bytes, index, line).kind);
  assert.deepEqual(kinds, ["value", "empty", "invalid", "too-large"]);
});

test("classify: 600 KB of a real tool schema is a value, not 'too large'", () => {
  // Regression: the 512 KB cap refused the 541 KB line in the report's file. A cap that is
  // smaller than one realistic record turns a previewer into a "cannot read this" panel.
  const line = `{"big":"${"x".repeat(600 * 1024)}"}`;
  const { bytes, index } = open(line);
  assert.equal(buildJsonlSummary(bytes, index, 0).kind, "value");
  assert.equal(buildJsonlEntry(bytes, index, 0).kind, "value");
});

test("summary: a line over the parse cap decodes only its head", () => {
  // The directory only needs the size and ~400 characters. Decoding the whole 8 MB+ line
  // allocated in proportion to the file before this short-circuit existed.
  const line = `{"blob":"${"A".repeat(JSONL_MAX_LINE_BYTES + 1_000)}"}`;
  const { bytes, index } = open(line);
  const summary = buildJsonlSummary(bytes, index, 0);
  assert.equal(summary.kind, "too-large");
  assert.equal(summary.size, line.length);
  assert.ok(summary.raw.startsWith('{"blob":"AAAA'));
  assert.ok(summary.raw.length <= 401, `summary raw is ${summary.raw.length} chars`);
});

test("detail: text past the cap is a marked prefix, not a silent cut", () => {
  const text = "x".repeat(JSONL_MAX_TEXT_CHARS + 25);
  const { bytes, index } = open(`{"text":"${text}"}`);
  const entry = buildJsonlEntry(bytes, index, 0);
  assert.equal(entry.textChars, text.length + 11);
  assert.equal(entry.textTruncated, true);
  assert.equal(entry.text.length, JSONL_MAX_TEXT_CHARS);
  assert.ok(!entry.text.endsWith("…"), "a suffix would hide the fact that text is missing");

  const small = open('{"a":1}');
  const whole = buildJsonlEntry(small.bytes, small.index, 0);
  assert.equal(whole.textTruncated, false);
  assert.equal(whole.textChars, whole.text.length);
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
