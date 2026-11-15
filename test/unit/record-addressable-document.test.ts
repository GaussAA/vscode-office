/**
 * Tests for the record-addressable document abstraction and its adapters.
 */
import { strict as assert } from "node:assert";
import test from "node:test";
import { TextEncoder } from "node:util";
import type { JsonlEntrySummary } from "@/common/jsonlTypes";
import { JsonlFile, memoryByteSource } from "@/service/jsonlFile";
import { jsonlAdapter } from "@/service/jsonlAdapter";
import { indexJsonArray } from "@/service/jsonPreview";
import { jsonArrayAdapter } from "@/service/jsonArrayAdapter";
import { createCancelToken, matchSnippet } from "@/service/recordAddressableDocument";

test("matchSnippet: returns full text when short", () => {
  const text = "hello world";
  const snippet = matchSnippet(text, "world");
  assert.equal(snippet, "hello world");
});

test("matchSnippet: centers snippet on match", () => {
  const text = "a".repeat(100) + "target" + "b".repeat(200);
  const snippet = matchSnippet(text, "target");
  assert.ok(snippet.includes("target"), "Snippet should include the match");
  assert.ok(snippet.startsWith("…"), "Should have leading ellipsis");
  assert.ok(snippet.endsWith("…"), "Should have trailing ellipsis");
  assert.ok(snippet.length < text.length, "Snippet should be shorter than original");
  assert.ok(snippet.length > 50, "Should have reasonable context");
});

test("matchSnippet: handles no match", () => {
  const text = "hello world";
  const snippet = matchSnippet(text, "missing");
  assert.ok(snippet.startsWith("hello"));
});

test("Unicode: fixes the Turkish İ bug", async () => {
  const problematic = "İ".repeat(40);
  const jsonl = `{"id": 0, "text": "${problematic}"}\n{"id": 1, "text": "target"}\n`;
  const bytes = new TextEncoder().encode(jsonl);
  const source = memoryByteSource(bytes);
  const file = await JsonlFile.open(source);
  const adapter = jsonlAdapter(file);

  const results: JsonlEntrySummary[] = [];
  const token = createCancelToken();
  let done = false;

  adapter.search(
    1,
    "target",
    {
      onBatch: (batch: any) => {
        results.push(...(batch.entries || []));
        done = batch.done;
      },
    },
    token,
  );

  await new Promise((resolve) => setTimeout(resolve, 100));

  assert.ok(done, "Search should complete");
  assert.equal(results.length, 1, "Should find exactly one match");
  assert.equal(results[0].index, 1, "Should match record 1, not record 0");
  assert.ok(results[0].snippet?.includes("target"), "Snippet should contain the match");
});

test("JSONL: reads records from line-delimited file", async () => {
  const jsonl = '{"a":1}\n{"b":2}\n{"c":3}\n';
  const bytes = new TextEncoder().encode(jsonl);
  const source = memoryByteSource(bytes);
  const file = await JsonlFile.open(source);
  const adapter = jsonlAdapter(file);

  assert.equal(adapter.recordCount, 3);
});

test("JSONL: searches with case-insensitive matching", async () => {
  const jsonl = '{"name":"Alice"}\n{"name":"Bob"}\n{"name":"Carol"}\n';
  const bytes = new TextEncoder().encode(jsonl);
  const source = memoryByteSource(bytes);
  const file = await JsonlFile.open(source);
  const adapter = jsonlAdapter(file);

  const results: JsonlEntrySummary[] = [];
  const token = createCancelToken();
  let done = false;

  adapter.search(
    1,
    "bob",
    {
      onBatch: (batch: any) => {
        results.push(...(batch.entries || []));
        done = batch.done;
      },
    },
    token,
  );

  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.ok(done);
  assert.equal(results.length, 1);
  assert.equal(results[0].index, 1);
});

test("JSONL: handles empty query", async () => {
  const jsonl = '{"a":1}\n';
  const bytes = new TextEncoder().encode(jsonl);
  const source = memoryByteSource(bytes);
  const file = await JsonlFile.open(source);
  const adapter = jsonlAdapter(file);

  const results: JsonlEntrySummary[] = [];
  const token = createCancelToken();
  let done = false;

  adapter.search(
    1,
    "",
    {
      onBatch: (batch: any) => {
        results.push(...(batch.entries || []));
        done = batch.done;
      },
    },
    token,
  );

  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.ok(done);
  assert.equal(results.length, 0);
});

test("JSON: reads records from array elements", async () => {
  const json = '[{"a":1},{"b":2},{"c":3}]';
  const records = indexJsonArray(json);
  const adapter = jsonArrayAdapter(json, records);

  assert.equal(adapter.recordCount, 3);
});

test("JSON: searches with case-insensitive matching", async () => {
  const json = '[{"name":"Alice"},{"name":"Bob"},{"name":"Carol"}]';
  const records = indexJsonArray(json);
  const adapter = jsonArrayAdapter(json, records);

  const results: any[] = [];
  const token = createCancelToken();
  let done = false;

  adapter.search(
    1,
    "bob",
    {
      onBatch: (batch) => {
        results.push(...batch.records);
        done = batch.done;
      },
    },
    token,
  );

  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.ok(done);
  assert.equal(results.length, 1);
  assert.equal(results[0].index, 1);
});

test("JSON: counts multiple matches in a record", async () => {
  const json = '[{"a":"test","b":"test"},{"c":"other"}]';
  const records = indexJsonArray(json);
  const adapter = jsonArrayAdapter(json, records);

  const results: any[] = [];
  const token = createCancelToken();
  let done = false;

  adapter.search(
    1,
    "test",
    {
      onBatch: (batch) => {
        results.push(...batch.records);
        done = batch.done;
      },
    },
    token,
  );

  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.ok(done);
  assert.equal(results.length, 1);
  assert.equal(results[0].index, 0);
  assert.equal(results[0].count, 2, "Should count both matches in the record");
});

test("JSON: cancels search early", async () => {
  const items = Array.from({ length: 1000 }, (_, i) => `{"id":${i}}`);
  const json = `[${items.join(",")}]`;
  const records = indexJsonArray(json);
  const adapter = jsonArrayAdapter(json, records);

  const results: any[] = [];
  const token = createCancelToken();
  let batchCount = 0;

  adapter.search(
    1,
    "id",
    {
      onBatch: (batch) => {
        results.push(...batch.records);
        batchCount++;
        if (batchCount === 2) {
          token.cancel();
        }
      },
    },
    token,
  );

  await new Promise((resolve) => setTimeout(resolve, 100));

  assert.ok(token.cancelled);
  assert.ok(results.length < 1000, "Should stop before scanning all records");
});

test("JSON: handles empty query", async () => {
  const json = '[{"a":1}]';
  const records = indexJsonArray(json);
  const adapter = jsonArrayAdapter(json, records);

  const results: any[] = [];
  const token = createCancelToken();
  let done = false;

  adapter.search(
    1,
    "",
    {
      onBatch: (batch) => {
        results.push(...batch.records);
        done = batch.done;
      },
    },
    token,
  );

  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.ok(done);
  assert.equal(results.length, 0);
});

test("JSON: fixes Unicode bug in array search", async () => {
  const problematic = "İ".repeat(40);
  const json = `[{"id":0,"text":"${problematic}"},{"id":1,"text":"target"}]`;
  const records = indexJsonArray(json);
  const adapter = jsonArrayAdapter(json, records);

  const results: any[] = [];
  const token = createCancelToken();
  let done = false;

  adapter.search(
    1,
    "target",
    {
      onBatch: (batch) => {
        results.push(...batch.records);
        done = batch.done;
      },
    },
    token,
  );

  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.ok(done);
  assert.equal(results.length, 1, "Should find exactly one match");
  assert.equal(results[0].index, 1, "Should match record 1, not record 0");
  assert.ok(results[0].snippet.includes("target"), "Snippet should contain the match");
});
