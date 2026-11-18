import assert from "node:assert/strict";
import test from "node:test";
import { JSON_MAX_ARRAY_BYTES } from "@/common/jsonPreviewTypes";
import {
  createJsonPreviewHandlers,
  readJsonSource,
  type JsonSource,
  type JsonSourceReader,
} from "@/provider/jsonPreviewHandlers";

const encode = (text: string) => new TextEncoder().encode(text);

/** A reader that records which of the three reach-the-document calls were actually made. */
function fakeReader(options: {
  buffer?: { text: string; isDirty: boolean };
  disk?: Uint8Array;
  diskSize?: number;
}) {
  const calls: string[] = [];
  const reader: JsonSourceReader = {
    openBuffer: () => {
      calls.push("openBuffer");
      return options.buffer;
    },
    stat: async () => {
      calls.push("stat");
      return { size: options.diskSize ?? options.disk?.byteLength ?? 0 };
    },
    readFile: async () => {
      calls.push("readFile");
      return options.disk ?? new Uint8Array(0);
    },
  };
  return { reader, calls };
}

// -------------------------------------------------- buffer versus disk

test("source: a fresh array stores its ranges once; cached ranges are not stored again", () => {
  const stored: Array<{ fingerprint: unknown; ranges: unknown }> = [];
  const text = '[{"id":1},{"id":2}]';
  const context = {
    fileName: "data.json",
    cacheId: "demo:json",
    read: async () => ({ text, byteSize: text.length, fromBuffer: false }),
    emit: () => {},
    reportError: () => {},
    storeRanges: (fingerprint: unknown, ranges: unknown) => stored.push({ fingerprint, ranges }),
  };
  const source: JsonSource = {
    text,
    byteSize: text.length,
    fromBuffer: false,
    fingerprint: { key: "demo:json", size: text.length, mtimeMs: 1 },
  };
  createJsonPreviewHandlers(context, source);
  assert.equal(stored.length, 1);
  assert.deepEqual(stored[0]?.fingerprint, source.fingerprint);

  const ranges = stored[0]?.ranges;
  stored.length = 0;
  createJsonPreviewHandlers(context, {
    ...source,
    records: ranges as Array<{ start: number; end: number }>,
  });
  assert.equal(stored.length, 0);
});

test("source: an object or scalar root does not store ranges", () => {
  const stored: unknown[] = [];
  const text = '{"a":1}';
  createJsonPreviewHandlers(
    {
      fileName: "data.json",
      cacheId: "demo:json",
      read: async () => ({ text, byteSize: text.length, fromBuffer: false }),
      emit: () => {},
      reportError: () => {},
      storeRanges: (_fingerprint, ranges) => stored.push(ranges),
    },
    {
      text,
      byteSize: text.length,
      fromBuffer: false,
      fingerprint: { key: "demo:json", size: text.length, mtimeMs: 1 },
    },
  );
  assert.equal(stored.length, 0);
});

test("source: an open buffer wins over the disk, and the disk is not touched", async () => {
  const { reader, calls } = fakeReader({
    buffer: { text: '["from buffer"]', isDirty: false },
    disk: encode('["from disk"]'),
  });
  const source = await readJsonSource(reader);

  assert.equal(source.text, '["from buffer"]');
  assert.deepEqual(calls, ["openBuffer"], "neither stat nor readFile may run");
});

test("source: fromBuffer means unsaved, so a clean open buffer reports false", async () => {
  const clean = await readJsonSource(
    fakeReader({ buffer: { text: "[1]", isDirty: false } }).reader,
  );
  assert.equal(clean.fromBuffer, false, "the buffer equals the disk; nothing to warn about");

  const dirty = await readJsonSource(fakeReader({ buffer: { text: "[1]", isDirty: true } }).reader);
  assert.equal(dirty.fromBuffer, true);
});

test("source: a buffer's byte size is its UTF-8 size, not its character count", async () => {
  const text = '["日本語"]';
  const source = await readJsonSource(fakeReader({ buffer: { text, isDirty: true } }).reader);
  assert.equal(source.byteSize, encode(text).length);
  assert.ok(source.byteSize > text.length, "multi-byte characters take more bytes than units");
});

test("source: with no buffer the disk is read, decoded, and is never fromBuffer", async () => {
  const disk = encode('[{"id":1}]');
  const { reader, calls } = fakeReader({ disk });
  const source = await readJsonSource(reader);

  assert.deepEqual(source, { text: '[{"id":1}]', byteSize: disk.byteLength, fromBuffer: false });
  assert.deepEqual(calls, ["openBuffer", "stat", "readFile"]);
});

test("source: a file above the array cap is not read at all", async () => {
  const { reader, calls } = fakeReader({
    disk: encode("[]"),
    diskSize: JSON_MAX_ARRAY_BYTES + 1,
  });
  const source = await readJsonSource(reader);

  assert.deepEqual(source, { text: "", byteSize: JSON_MAX_ARRAY_BYTES + 1, fromBuffer: false });
  assert.ok(!calls.includes("readFile"), "reading 500 MB just to say too-large is the bug");
});

test("source: a file exactly at the cap is still read", async () => {
  const { reader, calls } = fakeReader({ disk: encode("[]"), diskSize: JSON_MAX_ARRAY_BYTES });
  const source = await readJsonSource(reader);
  assert.ok(calls.includes("readFile"), "the cap is exclusive: only a larger file is skipped");
  assert.equal(source.text, "[]");
});

test("source: the open buffer is not subject to the disk cap", async () => {
  // The cap is about not reading a huge file; text the editor already holds costs nothing to take.
  const { reader, calls } = fakeReader({
    buffer: { text: "[1]", isDirty: false },
    diskSize: JSON_MAX_ARRAY_BYTES * 5,
  });
  const source = await readJsonSource(reader);
  assert.equal(source.text, "[1]");
  assert.ok(!calls.includes("stat"));
});

// -------------------------------------------------- the message loop

/** A read that rejects with this exact value, which need not be an `Error`. */
interface Rejection {
  rejectWith: unknown;
}

function harness(initial: JsonSource, reads: Array<JsonSource | Error | Rejection> = []) {
  const emitted: Array<{ type: string; payload: any }> = [];
  const errors: string[] = [];
  let reading = 0;
  const handlers = createJsonPreviewHandlers(
    {
      fileName: "data.json",
      cacheId: "file:file:///data.json",
      read: async () => {
        const next = reads[Math.min(reading++, reads.length - 1)];
        if (next instanceof Error) throw next;
        if ("rejectWith" in next) throw next.rejectWith;
        return next;
      },
      emit: (type, payload) => emitted.push({ type, payload }),
      reportError: (message) => errors.push(message),
    },
    initial,
  );
  return {
    handlers,
    emitted,
    errors,
    types: () => emitted.map((message) => message.type),
    last: (type: string) => {
      const hit = [...emitted].reverse().find((message) => message.type === type);
      if (!hit) throw new Error(`no ${type} message was emitted`);
      return hit.payload;
    },
  };
}

const source = (text: string, fromBuffer = false): JsonSource => ({
  text,
  byteSize: encode(text).length,
  fromBuffer,
});

test("init: announces the document, and the root entry for a non-array root", () => {
  const array = harness(source('[{"a":1},{"a":2}]'));
  array.handlers.init();
  assert.equal(array.last("jsonInfo").recordCount, 2);
  assert.deepEqual(array.types(), ["jsonInfo"], "an array has no root entry to ship");

  const object = harness(source('{"a":1}'));
  object.handlers.init();
  assert.deepEqual(object.types(), ["jsonInfo", "jsonRoot"]);
  assert.deepEqual(object.last("jsonRoot").entry.value, { a: 1 });
});

test("init: the info carries the file name, cache id and the unsaved flag it was opened with", () => {
  const h = harness(source("[1]", true));
  h.handlers.init();
  const info = h.last("jsonInfo");
  assert.equal(info.fileName, "data.json");
  assert.equal(info.cacheId, "file:file:///data.json");
  assert.equal(info.fromBuffer, true);
});

test("records: a window request is answered with its requestId", () => {
  const h = harness(source('[{"id":"a"},{"id":"b"},{"id":"c"}]'));
  h.handlers.records({ requestId: 4, start: 1, end: 3 });
  const payload = h.last("jsonRecordsData");
  assert.equal(payload.requestId, 4);
  assert.deepEqual(
    payload.records.map((record: { index: number }) => record.index),
    [1, 2],
  );
});

test("records: a malformed request is ignored", () => {
  const h = harness(source("[1,2]"));
  h.handlers.records(undefined);
  h.handlers.records({ start: 0, end: 1 });
  h.handlers.records({ requestId: 1, start: "0" as unknown as number, end: 1 });
  h.handlers.records({ requestId: 1, start: 0 });
  assert.deepEqual(h.types(), []);
});

test("record: one record is answered, and an out-of-range index answers with null", () => {
  const h = harness(source('[{"id":"a"},{"id":"b"}]'));
  h.handlers.record({ requestId: 2, index: 1 });
  assert.deepEqual(h.last("jsonRecordData").entry.value, { id: "b" });

  h.handlers.record({ requestId: 3, index: 9 });
  const missing = h.last("jsonRecordData");
  assert.equal(missing.requestId, 3, "the webview clears its loading flag on any reply");
  assert.equal(missing.entry, null);
});

test("record: a malformed request is ignored", () => {
  const h = harness(source("[1]"));
  h.handlers.record({ index: 0 });
  h.handlers.record({ requestId: 1 });
  h.handlers.record(undefined);
  assert.deepEqual(h.types(), []);
});

test("search: batches carry the requestId and the stream ends with done", async () => {
  const h = harness(source('[{"m":"alpha"},{"m":"beta"},{"m":"alpha two"}]'));
  await new Promise<void>((resolve) => {
    h.handlers.search({ requestId: 8, query: "alpha" });
    const timer = setInterval(() => {
      if (h.emitted.some((message) => message.payload?.done)) {
        clearInterval(timer);
        resolve();
      }
    }, 5);
  });
  const batches = h.emitted.filter((message) => message.type === "jsonSearchBatch");
  assert.ok(batches.every((batch) => batch.payload.requestId === 8));
  assert.equal(batches.at(-1)?.payload.done, true);
  assert.deepEqual(
    batches.flatMap((batch) =>
      batch.payload.records.map((record: { index: number }) => record.index),
    ),
    [0, 2],
  );
});

test("search: a malformed request is ignored", () => {
  const h = harness(source("[1]"));
  h.handlers.search(undefined);
  h.handlers.search({ requestId: 1 });
  h.handlers.search({ query: "x" });
  assert.deepEqual(h.types(), []);
});

// -------------------------------------------------- reload

test("reload: the new text replaces the session and is announced", async () => {
  const h = harness(source("[1]"), [source("[1,2,3]")]);
  const before = h.handlers.session;

  await h.handlers.reload();

  assert.notEqual(h.handlers.session, before, "a reload must build a new session");
  assert.equal(h.last("jsonInfo").recordCount, 3, "the reload must re-read, not reuse the index");
});

test("reload: file name and cache id are unchanged, so the webview can keep its query", async () => {
  // The webview keeps the search query only when `cacheId` and `rootKind` are the same across
  // two `jsonInfo` messages (JsonPreview.tsx `sameFile` / `sameShape`). The host's half of that
  // contract is that a reload never changes the identity.
  const h = harness(source('[{"a":1}]'), [source('[{"a":1},{"a":2}]')]);
  h.handlers.init();
  await h.handlers.reload();

  const infos = h.emitted.filter((message) => message.type === "jsonInfo").map((m) => m.payload);
  assert.equal(infos.length, 2);
  assert.equal(infos[1].cacheId, infos[0].cacheId);
  assert.equal(infos[1].fileName, infos[0].fileName);
  assert.equal(infos[1].rootKind, infos[0].rootKind);
  assert.notEqual(infos[1].recordCount, infos[0].recordCount, "the content did change");
});

test("reload: an unsaved buffer is reported as such after the reload", async () => {
  const h = harness(source("[1]", false), [source("[1,2]", true)]);
  await h.handlers.reload();
  assert.equal(h.last("jsonInfo").fromBuffer, true);
});

test("reload: an object root announces its root entry again", async () => {
  const h = harness(source('{"a":1}'), [source('{"a":2}')]);
  await h.handlers.reload();
  assert.deepEqual(h.types(), ["jsonInfo", "jsonRoot"]);
  assert.deepEqual(h.last("jsonRoot").entry.value, { a: 2 });
});

test("reload: a failed read keeps the old session, reports once, and emits nothing", async () => {
  const h = harness(source("[1,2]"), [new Error("EACCES: denied")]);
  const before = h.handlers.session;

  await h.handlers.reload();

  assert.equal(h.handlers.session, before, "the webview still shows the old session");
  assert.deepEqual(h.errors, ["EACCES: denied"]);
  assert.deepEqual(h.types(), []);

  h.handlers.records({ requestId: 1, start: 0, end: 2 });
  assert.equal(h.last("jsonRecordsData").records.length, 2, "the old session still answers");
});

test("reload: a non-Error failure is reported as text", async () => {
  const h = harness(source("[1]"), [{ rejectWith: "disk went away" }]);
  await h.handlers.reload();
  assert.deepEqual(h.errors, ["disk went away"]);
});

test("reload: a search running on the old session does not report after the reload", async () => {
  const text = `[${Array.from({ length: 50 }, (_, i) => `{"n":"row ${i}"}`).join(",")}]`;
  const h = harness(source(text), [source("[]")]);

  h.handlers.search({ requestId: 1, query: "row" });
  await h.handlers.reload(); // disposes the old session before its first scheduled batch runs
  await new Promise((resolve) => setTimeout(resolve, 40));

  assert.equal(
    h.emitted.filter((message) => message.type === "jsonSearchBatch").length,
    0,
    "the old document's results must not reach the webview as if they were the new one's",
  );
});

test("cancelSearch: stops the running search", async () => {
  const text = `[${Array.from({ length: 50 }, (_, i) => `{"n":"row ${i}"}`).join(",")}]`;
  const h = harness(source(text));
  h.handlers.search({ requestId: 1, query: "row" });
  h.handlers.cancelSearch();
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(h.emitted.filter((message) => message.type === "jsonSearchBatch").length, 0);
});

test("dispose: stops the running search of the current session", async () => {
  const text = `[${Array.from({ length: 50 }, (_, i) => `{"n":"row ${i}"}`).join(",")}]`;
  const h = harness(source(text));
  h.handlers.search({ requestId: 1, query: "row" });
  h.handlers.dispose();
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(h.emitted.filter((message) => message.type === "jsonSearchBatch").length, 0);
});

test("a file above the cap shows as too-large without any text", () => {
  const h = harness({ text: "", byteSize: JSON_MAX_ARRAY_BYTES + 1, fromBuffer: false });
  h.handlers.init();
  assert.equal(h.last("jsonInfo").rootKind, "too-large");
});
