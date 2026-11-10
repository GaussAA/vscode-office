import assert from "node:assert/strict";
import test from "node:test";
import { jsonPreviewText, tokenizeJson } from "@/react/view/parquet/parquetPreview";

test("parquet preview: JSON list strings become canonical JSON", () => {
  assert.equal(jsonPreviewText('["alpha", "beta"]'), '["alpha","beta"]');
  assert.equal(jsonPreviewText("  [1, true, null]  "), "[1,true,null]");
  assert.equal(jsonPreviewText('{"a": 1}'), '{"a":1}');
  assert.equal(jsonPreviewText("[]"), "[]");
});

test("parquet preview: real lists and objects are containers", () => {
  assert.equal(jsonPreviewText(["alpha", 2]), '["alpha",2]');
  assert.equal(jsonPreviewText({ a: 1, b: [true] }), '{"a":1,"b":[true]}');
  assert.equal(jsonPreviewText([1n]), '["1"]');
  assert.equal(jsonPreviewText([new Uint8Array([0, 1])]), '["0x0001"]');
});

test("parquet preview: scalars and malformed JSON stay plain text", () => {
  assert.equal(jsonPreviewText("alpha"), null);
  assert.equal(jsonPreviewText('"quoted"'), null);
  assert.equal(jsonPreviewText("[not json"), null);
  assert.equal(jsonPreviewText("a [bracketed] phrase"), null);
  assert.equal(jsonPreviewText(3), null);
  assert.equal(jsonPreviewText(null), null);
});

test("parquet preview: tokenizer labels syntax so the cell can colour it", () => {
  const tokens = tokenizeJson('{"name":"alpha","count":2,"ok":true,"none":null}');
  assert.deepEqual(
    tokens.map((token) => [token.type, token.text]),
    [
      ["punct", "{"],
      ["key", '"name"'],
      ["punct", ":"],
      ["string", '"alpha"'],
      ["punct", ","],
      ["key", '"count"'],
      ["punct", ":"],
      ["number", "2"],
      ["punct", ","],
      ["key", '"ok"'],
      ["punct", ":"],
      ["boolean", "true"],
      ["punct", ","],
      ["key", '"none"'],
      ["punct", ":"],
      ["null", "null"],
      ["punct", "}"],
    ],
  );
});

test("parquet preview: long values are truncated with an ellipsis token", () => {
  const tokens = tokenizeJson(JSON.stringify(Array.from({ length: 200 }, (_, index) => index)));
  assert.equal(tokens.at(-1)?.type, "ellipsis");
  assert.ok(tokens.length <= 81);
  assert.ok(tokens.reduce((total, token) => total + token.text.length, 0) <= 321);
});
