import assert from "node:assert/strict";
import test from "node:test";
import type { JsonlEntryDetail, JsonlEntrySummary, JsonlSearchBatch } from "@/common/jsonlTypes";
import { JsonlFile, memoryByteSource } from "@/service/jsonlFile";
import { JsonlSession, type JsonlSearchOptions } from "@/service/jsonlSession";

/** Build a session over literal JSONL text. */
async function makeSession(lines: string[]): Promise<JsonlSession> {
  const bytes = new TextEncoder().encode(lines.map((line) => `${line}\n`).join(""));
  return new JsonlSession(await JsonlFile.open(memoryByteSource(bytes)));
}

/** Run a scan to completion with a synchronous scheduler and collect the batches. */
async function runSearch(
  session: JsonlSession,
  query: string,
  options: Partial<JsonlSearchOptions> = {},
): Promise<JsonlSearchBatch[]> {
  const batches: JsonlSearchBatch[] = [];
  const handle = session.search(7, query, {
    onBatch: (batch) => batches.push(batch),
    schedule: (run) => run(),
    ...options,
  });
  await handle.finished;
  return batches;
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 10));

/**
 * `label` only exists on the `value` member of the entry union, so reaching for it is also an
 * assertion that the line parsed — spell that out instead of casting.
 */
function labelOf(entry: JsonlEntrySummary | JsonlEntryDetail): string | undefined {
  return entry.kind === "value" ? entry.label : undefined;
}

test("readRange: echoes the request id and clamps to the file", async () => {
  const session = await makeSession(['{"id":0}', '{"id":1}', '{"id":2}']);

  const first = await session.readRange(42, 0, 2);
  assert.equal(first.requestId, 42, "the reply must be attributable");
  assert.equal(first.start, 0);
  assert.deepEqual(
    first.entries.map((entry) => entry.index),
    [0, 1],
  );

  const past = await session.readRange(43, 2, 99);
  assert.deepEqual(
    past.entries.map((entry) => entry.index),
    [2],
    "end clamps to lineCount",
  );

  const backwards = await session.readRange(44, 5, 9);
  assert.deepEqual([backwards.start, backwards.entries.length], [3, 0]);
});

test("readRange: absolute line numbers survive the windowed read", async () => {
  const session = await makeSession(Array.from({ length: 40 }, (_, index) => `{"id":${index}}`));

  const payload = await session.readRange(1, 30, 35);
  assert.deepEqual(
    payload.entries.map((entry) => entry.index),
    [30, 31, 32, 33, 34],
  );
  assert.equal(labelOf(payload.entries[0]), "30");
});

test("readEntry: echoes the request id, and rejects an out-of-range line", async () => {
  const session = await makeSession(['{"id":"a","name":"first"}', '{"id":"b"}']);

  const payload = await session.readEntry(9, 0);
  assert.ok(payload, "a valid line must come back");
  assert.ok(payload.entry, "a valid line must carry an entry");
  assert.equal(payload.requestId, 9);
  assert.equal(payload.index, 0);
  assert.equal(labelOf(payload.entry), "a");

  assert.equal(await session.readEntry(10, 2), null);
  assert.equal(await session.readEntry(11, -1), null);
});

test("readEntry: works for the last line of a file without a trailing newline", async () => {
  const bytes = new TextEncoder().encode('{"id":"a"}\n{"id":"b"}');
  const session = new JsonlSession(await JsonlFile.open(memoryByteSource(bytes)));

  const payload = await session.readEntry(5, 1);
  assert.ok(payload, "the last line must come back");
  assert.ok(payload.entry, "the last line must carry an entry");
  assert.equal(payload.index, 1);
  assert.equal(labelOf(payload.entry), "b");
});

test("search: streams matches in batches and ends with done", async () => {
  const session = await makeSession(['{"name":"alpha"}', '{"name":"beta"}', '{"name":"alphabet"}']);

  const batches = await runSearch(session, "alpha");

  assert.equal(batches.length, 1, "a small file finishes in one batch");
  const [batch] = batches;
  assert.equal(batch.requestId, 7);
  assert.equal(batch.query, "alpha");
  assert.equal(batch.matches, 2);
  assert.equal(batch.done, true);
  assert.equal(batch.capped, false);
  assert.equal(batch.total, 3);
  assert.deepEqual(
    batch.entries.map((entry) => entry.index),
    [0, 2],
  );
  const [hit] = batch.entries;
  assert.ok(hit.kind === "value", "a matched line is a parsed value");
  assert.ok(hit.snippet, "a matched line carries a snippet");
  assert.ok(hit.snippet.includes("alpha"), "the snippet is centred on the match");
});

test("search: an empty query answers immediately with a finished batch", async () => {
  const session = await makeSession(['{"id":1}']);
  const batches = await runSearch(session, "   ");

  assert.equal(batches.length, 1);
  const [batch] = batches;
  assert.equal(batch.done, true);
  assert.equal(batch.entries.length, 0);
  assert.equal(batch.matches, 0);
});

test("search: stops at maxMatches and says it was capped", async () => {
  const session = await makeSession(['{"n":1}', '{"n":1}', '{"n":1}']);
  const batches = await runSearch(session, "n", { maxMatches: 1 });

  const last = batches.at(-1);
  assert.ok(last, "a scan always reports at least one batch");
  assert.equal(last.capped, true);
  assert.equal(last.done, true);
  assert.equal(last.matches, 1);
});

test("search: a newer scan cancels the old one instead of finishing it", async () => {
  const lines = Array.from({ length: 200 }, (_, index) => `{"id":${index}}`);
  const session = await makeSession(lines);

  const firstBatches: JsonlSearchBatch[] = [];
  const handle = session.search(1, "id", {
    step: 1,
    batchSize: 1,
    onBatch: (batch) => firstBatches.push(batch),
    // One turn per macrotask, so the scan is genuinely mid-flight when we cancel.
    schedule: (run) => setTimeout(() => run(), 0),
  });

  await tick();
  const beforeCancel = firstBatches.length;
  assert.ok(beforeCancel > 0, "the scan had started");
  const midScan = firstBatches.at(-1);
  assert.ok(midScan, "a batch arrived before the cancel");
  assert.ok(midScan.scanned < 200, "the scan had not finished");

  handle.cancel();
  await handle.finished;
  await tick();

  assert.equal(firstBatches.length, beforeCancel, "no batch arrives after cancel()");
  const afterCancel = firstBatches.at(-1);
  assert.ok(afterCancel, "the earlier batches are still there");
  assert.equal(afterCancel.done, false, "a cancelled scan never reports done");
  assert.equal(handle.done, true);
});

test("search: starting a second scan cancels the first one host-side", async () => {
  const lines = Array.from({ length: 40 }, (_, index) => `{"id":${index}}`);
  const session = await makeSession(lines);

  const first: JsonlSearchBatch[] = [];
  const firstRun = session.search(1, "id", {
    step: 5,
    onBatch: (batch) => first.push(batch),
    schedule: (run) => queueMicrotask(run),
  });
  await tick();

  const second: JsonlSearchBatch[] = [];
  const secondRun = session.search(2, "id", {
    step: 5,
    onBatch: (batch) => second.push(batch),
    schedule: (run) => queueMicrotask(run),
  });
  await secondRun.finished;
  await tick();

  assert.ok(first.length > 0);
  assert.ok(second.length > 0);
  assert.ok(
    second.every((batch) => batch.requestId === 2),
    "the new scan owns the emissions",
  );
  assert.equal(firstRun.done, true, "the first scan stopped");
});

test("search: a scan over several steps still reports absolute line numbers", async () => {
  const lines = Array.from({ length: 12 }, (_, index) => `{"id":${index},"tag":"hit"}`);
  const session = await makeSession(lines);

  const batches = await runSearch(session, "hit", { step: 5 });
  const all = batches.flatMap((batch) => batch.entries.map((entry) => entry.index));

  assert.deepEqual(
    all,
    lines.map((_, index) => index),
  );
  const last = batches.at(-1);
  assert.ok(last, "a scan always reports at least one batch");
  assert.equal(last.done, true);
});

test("readRange: a byte budget bounds one window, not the whole file", async () => {
  const lines = Array.from(
    { length: 20 },
    (_, index) => `{"id":${index},"pad":"${"x".repeat(600 * 1024)}"}`,
  );
  const session = await makeSession(lines);

  const payload = await session.readRange(1, 0, 20);
  assert.equal(payload.start, 0);
  assert.ok(payload.entries.length < 20, `returned every line: ${payload.entries.length}`);
  assert.ok(payload.entries.length >= 1);
  assert.deepEqual(
    payload.entries.map((entry) => entry.index),
    Array.from({ length: payload.entries.length }, (_, index) => index),
    "the window still starts at the requested line and stays contiguous",
  );
});

test("readRange: the anchor is kept even when the budget would cut before it", async () => {
  const lines = Array.from(
    { length: 20 },
    (_, index) => `{"id":${index},"pad":"${"x".repeat(600 * 1024)}"}`,
  );
  const session = await makeSession(lines);

  const payload = await session.readRange(2, 0, 20, 18);
  assert.ok(payload.start <= 18, `the window starts after the selected row: ${payload.start}`);
  assert.ok(
    payload.entries.some((entry) => entry.index === 18),
    "the anchored line is in the window",
  );
  assert.ok(payload.entries.length >= 1);
  // Context above the anchor is bounded too: the reply cannot grow back to the whole file.
  assert.ok(payload.start > 0, "a byte-bounded window does not restart at line 0");
});

test("readRange: small lines keep their context above the anchor", async () => {
  const session = await makeSession(Array.from({ length: 40 }, (_, index) => `{"id":${index}}`));
  const payload = await session.readRange(3, 0, 40, 30);
  assert.equal(payload.start, 0, "no byte pressure means no recentring");
  assert.equal(payload.entries.length, 40);
});
