import assert from "node:assert/strict";
import test from "node:test";
import {
  JsonPreviewSession,
  JsonScanError,
  indexJsonArray,
  lineColumnAt,
  readJsonRecordDetail,
  readJsonRecordSummary,
} from "@/service/jsonPreview";
import type { JsonSearchBatch } from "@/common/jsonPreviewTypes";

const textBytes = (text: string) => new TextEncoder().encode(text).length;

function session(text: string, byteSize = textBytes(text)) {
  return new JsonPreviewSession(text, byteSize, "data.json", "demo:json", false);
}

test("indexJsonArray: pretty, minified and nested records", () => {
  const pretty = '  [\n  {"id": 1},\n  [2, 3],\n  "a]b,c",\n  null\n]  ';
  const records = indexJsonArray(pretty);
  assert.equal(records.length, 4);
  assert.deepEqual(pretty.slice(records[0].start, records[0].end), '{"id": 1}');
  assert.deepEqual(pretty.slice(records[1].start, records[1].end), "[2, 3]");
  assert.deepEqual(pretty.slice(records[2].start, records[2].end), '"a]b,c"');
  assert.deepEqual(pretty.slice(records[3].start, records[3].end), "null");
});

test("indexJsonArray: strings with escapes do not confuse the depth scanner", () => {
  const text = String.raw`[{"x":"quote \" brace } bracket ]"},{"y":"backslash \\ end"}]`;
  const records = indexJsonArray(text);
  assert.equal(records.length, 2);
  assert.equal(
    JSON.parse(text.slice(records[0].start, records[0].end)).x,
    'quote " brace } bracket ]',
  );
});

test("indexJsonArray: empty array and whitespace/BOM", () => {
  assert.deepEqual(indexJsonArray("\uFEFF  [ ] \n"), []);
  assert.deepEqual(indexJsonArray("[]"), []);
});

test("indexJsonArray: strict errors carry an offset", () => {
  for (const [text, message] of [
    ["[1,]", "Trailing comma"],
    ["[1 2]", "Expected a comma"],
    ["[1", "Unterminated array"],
    ["[,1]", "Missing value"],
    ["[1] trailing", "trailing"],
  ] as const) {
    assert.throws(
      () => indexJsonArray(text),
      (error) => error instanceof JsonScanError && error.message.includes(message),
      text,
    );
  }
});

test("lineColumnAt: one-based line and column", () => {
  const text = '{\n "a": 1,\n "b": 2\n}';
  const at = text.indexOf("1");
  assert.deepEqual(lineColumnAt(text, at), { line: 2, column: 7 });
});

test("session: array info, labels, raw fallback and record detail", () => {
  const text = '[{"id":"alpha","name":"A"},{"name":"B"},42,{"id":3}]';
  const preview = session(text);
  assert.equal(preview.info.rootKind, "array");
  assert.equal(preview.info.recordCount, 4);
  const records = preview.recordsInWindow(0, 4);
  assert.equal(records.length, 4);
  assert.equal(records[0].label, "alpha");
  assert.equal(records[1].label, "B");
  assert.equal(records[2].kind, "value");
  assert.equal(records[2].label, undefined);
  assert.equal(records[3].label, "3");
  assert.equal(records[2].raw, "42");

  const detail = preview.record(0);
  assert.ok(detail);
  assert.equal(detail.kind, "value");
  assert.equal(detail.index, 0);
  assert.deepEqual(detail.value, { id: "alpha", name: "A" });
  assert.equal(detail.text, '{"id":"alpha","name":"A"}');
  assert.equal(preview.record(4), null);
  assert.equal(preview.recordsInWindow(3, 99).length, 1);
});

test("session: object and scalar roots are parsed whole", () => {
  const object = session('  {"a": 1, "b": [2]}  ');
  assert.equal(object.info.rootKind, "object");
  assert.equal(object.info.recordCount, 0);
  assert.equal(object.rootEntry?.kind, "value");
  if (object.rootEntry?.kind === "value") {
    assert.deepEqual(object.rootEntry.value, { a: 1, b: [2] });
  }

  const scalar = session("  true  ");
  assert.equal(scalar.info.rootKind, "scalar");
  assert.equal(scalar.rootEntry?.kind, "value");
  if (scalar.rootEntry?.kind === "value") assert.equal(scalar.rootEntry.value, true);
});

test("session: invalid and empty roots expose line/column", () => {
  const invalid = session('{\n "a": 1,\n broken\n}');
  assert.equal(invalid.info.rootKind, "invalid");
  assert.equal(invalid.info.error?.line, 3);
  assert.ok((invalid.info.error?.column ?? 0) > 0);

  const empty = session("   ");
  assert.equal(empty.info.rootKind, "invalid");
  assert.equal(empty.info.error?.message, "Empty JSON document");
});

test("session: file size caps are checked before parsing", () => {
  const arrayTooLarge = new JsonPreviewSession(
    "[]",
    101 * 1024 * 1024,
    "big.json",
    "demo:big",
    false,
  );
  assert.equal(arrayTooLarge.info.rootKind, "too-large");

  const objectTooLarge = new JsonPreviewSession(
    "{}",
    21 * 1024 * 1024,
    "big-object.json",
    "demo:big-object",
    false,
  );
  assert.equal(objectTooLarge.info.rootKind, "too-large");
});

test("record: malformed and too-large records are marked, not thrown", () => {
  const text = '[{"a":}]';
  const ranges = indexJsonArray(text);
  const summary = readJsonRecordSummary(text, ranges[0], 0);
  assert.equal(summary.kind, "invalid");
  assert.ok(summary.error);

  const detail = readJsonRecordDetail(text, ranges[0], 0);
  assert.equal(detail.kind, "invalid");
  assert.ok(detail.error);

  const huge = `{"x":"${"a".repeat(8 * 1024 * 1024)}"}`;
  const hugeText = `[${huge}]`;
  const hugeRange = indexJsonArray(hugeText)[0];
  const hugeSummary = readJsonRecordSummary(hugeText, hugeRange, 0);
  assert.equal(hugeSummary.kind, "too-large");
  const hugeDetail = readJsonRecordDetail(hugeText, hugeRange, 0);
  assert.equal(hugeDetail.kind, "too-large");
  assert.equal(hugeDetail.textTruncated, true);
});

test("search: case-insensitive, per-record counts, snippets, done batch", async () => {
  const text = '[{"msg":"Alpha alpha"},{"msg":"beta"},{"other":"ALPHA"}]';
  const preview = session(text);
  const batches: JsonSearchBatch[] = [];
  await new Promise<void>((resolve) => {
    preview.search(7, "alpha", {
      batchSize: 1,
      onBatch: (batch) => {
        batches.push(batch);
        if (batch.done) resolve();
      },
    });
  });
  assert.equal(batches.at(-1)?.done, true);
  const records = batches.flatMap((batch) => batch.records);
  assert.equal(records.length, 2);
  assert.deepEqual(
    records.map((record) => [record.index, record.count]),
    [
      [0, 2],
      [2, 1],
    ],
  );
  assert.match(records[0].snippet, /Alpha alpha/i);
  assert.equal(batches.at(-1)?.matches, 3);
  assert.ok(batches.every((batch) => batch.requestId === 7));
});

test("search: a match in the whitespace between records is ignored", async () => {
  const text = "[1,\n 2]";
  const preview = session(text);
  const batches: JsonSearchBatch[] = [];
  await new Promise<void>((resolve) => {
    preview.search(1, ",\n", {
      onBatch: (batch) => {
        batches.push(batch);
        if (batch.done) resolve();
      },
    });
  });
  assert.equal(batches.at(-1)?.records.length, 0);
});
