/**
 * Regression tests for case-insensitive search over text that contains characters whose
 * lowercase form has a different UTF-16 length (Turkish İ, U+0130, lowercases to "i̇": two
 * code units).
 *
 * The JSONL path used to decide a hit on `line.toLowerCase()` and then cut the snippet out of
 * the ORIGINAL line at an offset measured in the lowercased copy, so every İ before the match
 * shifted the cut by one. The JSON path compared one code unit at a time and could never match
 * a query that itself contains İ. Both paths now share one matcher; these tests drive both
 * through their public adapters.
 */
import { strict as assert } from "node:assert";
import test from "node:test";
import type { JsonSearchBatch } from "@/common/jsonPreviewTypes";
import type { JsonlSearchBatch } from "@/common/jsonlTypes";
import { jsonArrayAdapter } from "@/service/jsonArrayAdapter";
import { jsonlAdapter } from "@/service/jsonlAdapter";
import { JsonlFile, memoryByteSource } from "@/service/jsonlFile";
import { indexJsonArray } from "@/service/jsonPreview";
import { createCancelToken } from "@/service/recordAddressableDocument";

async function searchJsonl(text: string, query: string): Promise<JsonlSearchBatch[]> {
  const file = await JsonlFile.open(memoryByteSource(new TextEncoder().encode(text)));
  const adapter = jsonlAdapter(file);
  const batches: JsonlSearchBatch[] = [];
  await new Promise<void>((resolve) => {
    adapter.search(
      1,
      query,
      {
        onBatch: (batch) => {
          batches.push(batch);
          if (batch.done) resolve();
        },
      },
      createCancelToken(),
    );
  });
  return batches;
}

async function searchJson(text: string, query: string): Promise<JsonSearchBatch[]> {
  const adapter = jsonArrayAdapter(text, indexJsonArray(text));
  const batches: JsonSearchBatch[] = [];
  await new Promise<void>((resolve) => {
    adapter.search(
      1,
      query,
      {
        onBatch: (batch) => {
          batches.push(batch);
          if (batch.done) resolve();
        },
      },
      createCancelToken(),
    );
  });
  return batches;
}

const PADDING = "İ".repeat(200);

test("JSONL: 200 İ before the match do not shift the snippet", async () => {
  const batches = await searchJsonl(`{"id": "${PADDING}target"}\n{"id": "other"}\n`, "target");
  const entries = batches.flatMap((batch) => batch.entries);
  assert.deepEqual(
    entries.map((entry) => entry.index),
    [0],
    "only line 0 matches",
  );
  // The match starts at UTF-16 offset 208; the snippet keeps 48 characters on each side.
  assert.equal(entries[0].snippet, `…${"İ".repeat(48)}target"}`);
  assert.equal(batches.at(-1)?.matches, 1);
});

test("JSONL: a line full of İ that does not contain the query is not a hit", async () => {
  const batches = await searchJsonl(`{"id": "${PADDING}"}\n`, "target");
  assert.equal(batches.flatMap((batch) => batch.entries).length, 0);
  assert.equal(batches.at(-1)?.done, true);
  assert.equal(batches.at(-1)?.matches, 0);
});

test("JSONL: a query containing İ matches İ in any letter case", async () => {
  const text = `{"city": "İstanbul"}\n{"city": "Ankara"}\n`;
  for (const query of ["İstanbul", "İSTANBUL", "i̇stanbul"]) {
    const entries = (await searchJsonl(text, query)).flatMap((batch) => batch.entries);
    assert.deepEqual(
      entries.map((entry) => entry.index),
      [0],
      `query ${JSON.stringify(query)}`,
    );
    assert.ok(entries[0].snippet?.includes("İstanbul"), `snippet for ${JSON.stringify(query)}`);
  }
});

test("JSONL: plain ASCII 'istanbul' still does not match İstanbul (unchanged)", async () => {
  const entries = (await searchJsonl(`{"city": "İstanbul"}\n`, "istanbul")).flatMap(
    (batch) => batch.entries,
  );
  assert.equal(entries.length, 0);
});

test("JSONL: searching does not lowercase a whole line", async () => {
  // A 300,000-character line is searched; no toLowerCase call may receive anything near it.
  const line = `{"blob": "${"İa".repeat(150_000)}needle"}\n`;
  const descriptor = Object.getOwnPropertyDescriptor(String.prototype, "toLowerCase");
  assert.ok(descriptor, "String.prototype.toLowerCase is defined");
  const original = descriptor.value as (this: string) => string;
  let longest = 0;
  Object.defineProperty(String.prototype, "toLowerCase", {
    ...descriptor,
    value: function (this: string) {
      if (this.length > longest) longest = this.length;
      return original.call(this);
    },
  });
  try {
    const entries = (await searchJsonl(line, "needle")).flatMap((batch) => batch.entries);
    assert.equal(entries.length, 1);
    assert.ok(entries[0].snippet?.includes("needle"));
  } finally {
    Object.defineProperty(String.prototype, "toLowerCase", descriptor);
  }
  assert.ok(longest < 1_000, `toLowerCase received a ${longest}-character string`);
});

test("JSON: 200 İ before the match keep the snippet on the match", async () => {
  const batches = await searchJson(`[{"id":"${PADDING}target"},{"id":"other"}]`, "target");
  const records = batches.flatMap((batch) => batch.records);
  assert.deepEqual(
    records.map((record) => record.index),
    [0],
  );
  assert.equal(records[0].count, 1);
  // The record text is `{"id":"` + 200 İ + `target"}`: the match starts at offset 207, the JSON
  // snippet keeps 50 characters before it and everything after it (the record ends first).
  assert.equal(records[0].snippet, `…${"İ".repeat(50)}target"}`);
});

test("JSON: a query containing İ matches İ in any letter case", async () => {
  const text = '["İstanbul", "Ankara", "İzmir", "istanbul"]';
  for (const query of ["İstanbul", "İSTANBUL", "i̇stanbul"]) {
    const records = (await searchJson(text, query)).flatMap((batch) => batch.records);
    assert.deepEqual(
      records.map((record) => record.index),
      [0],
      `query ${JSON.stringify(query)}`,
    );
    assert.ok(records[0].snippet.includes("İstanbul"));
  }
});

test("JSON: plain ASCII 'istanbul' matches only the ASCII record, not İstanbul", async () => {
  const records = (await searchJson('["İstanbul", "Istanbul"]', "istanbul")).flatMap(
    (batch) => batch.records,
  );
  assert.deepEqual(
    records.map((record) => record.index),
    [1],
  );
});

test("JSON: a record full of İ that does not contain the query is not a hit", async () => {
  const batches = await searchJson(`["${PADDING}"]`, "target");
  assert.equal(batches.flatMap((batch) => batch.records).length, 0);
  assert.equal(batches.at(-1)?.done, true);
});

test("JSON: counts every occurrence even when İ precedes them", async () => {
  const batches = await searchJson(`["İİİ target İİİ TARGET"]`, "target");
  const records = batches.flatMap((batch) => batch.records);
  assert.equal(records.length, 1);
  assert.equal(records[0].count, 2);
  assert.equal(batches.at(-1)?.matches, 2);
});
