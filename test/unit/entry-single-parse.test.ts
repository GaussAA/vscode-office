/**
 * One classification, one parse, one byte-size algorithm.
 *
 * Every JSON record and every root went through `classifyEntry` and then parsed or encoded
 * again on its own. These tests count the calls to `JSON.parse` and `TextEncoder.encode`.
 */
import { strict as assert } from "node:assert";
import { mock, test } from "node:test";
import { JSON_RECORD_MAX_BYTES } from "@/common/jsonPreviewTypes";
import { classifyEntry, truncate, utf8ByteSize } from "@/service/entryClassifier";
import {
  JsonPreviewSession,
  readJsonRecordDetail,
  readJsonRecordSummary,
} from "@/service/jsonPreview";

function session(text: string): JsonPreviewSession {
  return new JsonPreviewSession(text, utf8ByteSize(text), "data.json", "demo:json", false);
}

/** Run `work` and report how many times JSON.parse and TextEncoder#encode were called. */
function countCalls<T>(work: () => T): { result: T; parses: number; encodes: number } {
  const parse = mock.method(JSON, "parse");
  const encode = mock.method(TextEncoder.prototype, "encode");
  try {
    const result = work();
    return { result, parses: parse.mock.callCount(), encodes: encode.mock.callCount() };
  } finally {
    parse.mock.restore();
    encode.mock.restore();
  }
}

const RECORD = '{"id":"a","tags":["x","y"]}';
const RANGE = { start: 0, end: RECORD.length };

test("detail: a record is parsed exactly once and never encoded", () => {
  const { result, parses, encodes } = countCalls(() => readJsonRecordDetail(RECORD, RANGE, 0));
  assert.equal(result.kind, "value");
  assert.equal(parses, 1);
  assert.equal(encodes, 0);
});

test("summary: a record is parsed exactly once and never encoded", () => {
  const { result, parses, encodes } = countCalls(() => readJsonRecordSummary(RECORD, RANGE, 0));
  assert.equal(result.kind, "value");
  assert.equal(parses, 1);
  assert.equal(encodes, 0);
});

test("detail and summary: an invalid record is parsed once, a too-large one not at all", () => {
  const broken = '{"id":';
  const invalid = countCalls(() =>
    readJsonRecordDetail(broken, { start: 0, end: broken.length }, 0),
  );
  assert.equal(invalid.result.kind, "invalid");
  assert.equal(invalid.parses, 1);

  const huge = `"${"x".repeat(JSON_RECORD_MAX_BYTES)}"`;
  const range = { start: 0, end: huge.length };
  const detail = countCalls(() => readJsonRecordDetail(huge, range, 0));
  const summary = countCalls(() => readJsonRecordSummary(huge, range, 0));
  assert.equal(detail.result.kind, "too-large");
  assert.equal(summary.result.kind, "too-large");
  assert.equal(detail.parses, 0);
  assert.equal(summary.parses, 0);
  assert.equal(detail.encodes, 0, "an over-limit record is measured, not encoded");
  assert.equal(summary.encodes, 0);
});

test("root: an object or scalar root is parsed exactly once, with no encoding", () => {
  for (const [text, kind] of [
    ['{"a":1,"b":[2]}', "object"],
    ["true", "scalar"],
    ['"text"', "scalar"],
  ] as const) {
    const { result, parses, encodes } = countCalls(() => session(text));
    // `session()` measures the document itself with utf8ByteSize, which must not encode.
    assert.equal(result.info.rootKind, kind, text);
    assert.equal(result.rootEntry?.kind, "value", text);
    assert.equal(parses, 1, `${text}: parses`);
    assert.equal(encodes, 0, `${text}: encodes`);
  }
});

test("root: a syntax error still reports the line and column of the failure", () => {
  const invalid = session('{\n "a": 1,\n broken\n}');
  assert.equal(invalid.info.rootKind, "invalid");
  assert.equal(invalid.info.error?.line, 3);
  assert.equal(invalid.rootEntry, null);
});

test("root: leading whitespace does not move the reported line", () => {
  const invalid = session('\n\n  {"a": }');
  assert.equal(invalid.info.rootKind, "invalid");
  assert.equal(invalid.info.error?.line, 3);
});

test("root: a root of characters JSON does not allow is invalid, not an empty crash", () => {
  const invalid = session("\u00a0");
  assert.equal(invalid.info.rootKind, "invalid");
  assert.ok(invalid.info.error?.message, "the error says something");
  assert.notEqual(invalid.info.error?.message, "undefined");
});

test("root: size is the UTF-8 byte size, not the character count", () => {
  const object = session('{"city":"İstanbul 你好"}');
  assert.equal(object.rootEntry?.size, utf8ByteSize('{"city":"İstanbul 你好"}'));
  assert.notEqual(object.rootEntry?.size, '{"city":"İstanbul 你好"}'.length);
});

test("utf8ByteSize: agrees with TextEncoder on every kind of character", () => {
  const samples = [
    "",
    "ascii",
    "é ñ ü",
    "你好，世界",
    "İstanbul",
    "😀 emoji 🎉",
    "mixed 😀 你 a",
    "\u0000\u007f\u0080\u07ff\u0800\uffff",
    "lone high \ud83d surrogate",
    "lone low \ude00 surrogate",
    "ends with high \ud83d",
    "\ud83d\ud83d\ude00",
  ];
  for (const sample of samples) {
    assert.equal(
      utf8ByteSize(sample),
      new TextEncoder().encode(sample).length,
      JSON.stringify(sample),
    );
  }
});

test("classifyEntry: a text over the limit is classified without encoding or parsing it", () => {
  const text = `"${"y".repeat(5_000)}"`;
  const { result, parses, encodes } = countCalls(() => classifyEntry(text, 1_000));
  assert.equal(result.kind, "too-large");
  assert.equal(result.byteSize, 5_002);
  assert.equal(parses, 0);
  assert.equal(encodes, 0);
});

test("classifyEntry: the BOM and trailing terminators are removed, nothing else", () => {
  const result = classifyEntry('\ufeff{"a":1}\r\n');
  assert.equal(result.kind, "value");
  assert.equal(result.text, '{"a":1}');
  assert.equal(result.byteSize, 7);
  assert.equal(classifyEntry(" \t\r\n").kind, "empty");
});

test("classifyEntry: an invalid text keeps the thrown error for position reporting", () => {
  const result = classifyEntry('{"a":1,}');
  assert.equal(result.kind, "invalid");
  assert.ok(result.parseError instanceof SyntaxError);
  assert.equal(result.error, (result.parseError as Error).message);
});

test("truncate: keeps the head and marks the cut", () => {
  assert.equal(truncate("abcdef", 6), "abcdef");
  assert.equal(truncate("abcdef", 3), "abc…");
});
