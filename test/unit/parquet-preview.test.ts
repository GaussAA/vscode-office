import assert from "node:assert/strict";
import test from "node:test";
import { jsonPrettyText, jsonPreviewText, tokenizeJson } from "@/react/view/parquet/parquetPreview";

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

test("parquet preview: the inspector pretty-prints real containers and JSON strings", () => {
  assert.equal(
    jsonPrettyText('{"source":"hf","index":0,"ok":true}'),
    '{\n  "source": "hf",\n  "index": 0,\n  "ok": true\n}',
  );
  assert.equal(jsonPrettyText(["alpha"]), '[\n  "alpha"\n]');
  assert.equal(jsonPrettyText({ a: 1, b: [true] }), '{\n  "a": 1,\n  "b": [\n    true\n  ]\n}');
  assert.equal(jsonPrettyText("alpha"), null);
  assert.equal(jsonPrettyText("[not json"), null);
  assert.equal(jsonPrettyText(null), null);
  assert.equal(jsonPrettyText('"quoted"'), null);
});

test("parquet preview: the inspector tokenizer keeps whitespace for indentation", () => {
  const text = '{\n  "source": "hf",\n  "index": 0\n}';
  const tokens = tokenizeJson(text, {
    preserveWhitespace: true,
    maxTokens: Number.POSITIVE_INFINITY,
    maxChars: Number.POSITIVE_INFINITY,
  });
  assert.equal(tokens.map((token) => token.text).join(""), text);
  assert.deepEqual(
    tokens.filter((token) => token.type === "space").map((token) => token.text),
    ["\n  ", " ", "\n  ", " ", "\n"],
  );
  // Keys are still labelled across the whitespace gap.
  assert.ok(tokens.some((token) => token.type === "key" && token.text === '"source"'));
  assert.ok(tokens.some((token) => token.type === "string" && token.text === '"hf"'));
  assert.ok(tokens.some((token) => token.type === "number" && token.text === "0"));
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
