import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJsonlHandlers } from "../../out/unit-tests/jsonlHandlers.mjs";
import { JsonlFile, fileByteSource } from "../../out/unit-tests/jsonlFile.mjs";
import { JsonlSession } from "../../out/unit-tests/jsonlSession.mjs";

const lines = (count) =>
  Array.from({ length: count }, (_, i) => JSON.stringify({ id: i, msg: `row ${i}` })).join("\n");

/**
 * A real session over a real temp file, plus a collector for what the provider would have
 * posted to the webview. This is the glue `verify:ui` cannot reach (it stubs the webview),
 * so it is exercised here instead.
 */
async function harness(contents) {
  const dir = mkdtempSync(join(tmpdir(), "jsonl-handlers-"));
  const path = join(dir, "log.jsonl");
  writeFileSync(path, contents);

  let session = new JsonlSession(await JsonlFile.open(await fileByteSource(path)));
  const emitted = [];
  const handlers = createJsonlHandlers({
    session: () => session,
    reopen: async () => {
      const previous = session;
      session = new JsonlSession(await JsonlFile.open(await fileByteSource(path)));
      previous.dispose();
    },
    emit: (type, payload) => emitted.push({ type, payload }),
    info: () => ({
      fileName: "log.jsonl",
      cacheId: "cache",
      lineCount: session.lineCount,
      byteSize: session.byteSize,
    }),
  });

  return {
    handlers,
    emitted,
    path,
    dir,
    get session() {
      return session;
    },
    types: () => emitted.map((message) => message.type),
    last: (type) => [...emitted].reverse().find((message) => message.type === type),
    cleanup: async () => {
      session.dispose();
      await new Promise((resolve) => setTimeout(resolve, 20));
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 60));

test("init: reports the document so the webview can size its directory", async () => {
  const h = await harness(lines(3));
  try {
    h.handlers.init();
    const info = h.last("jsonlInfo").payload;
    assert.equal(info.lineCount, 3);
    assert.equal(info.fileName, "log.jsonl");
    assert.ok(info.byteSize > 0);
  } finally {
    await h.cleanup();
  }
});

test("index: a range request is answered with entries and the original requestId", async () => {
  const h = await harness(lines(5));
  try {
    await h.handlers.index({ requestId: 7, start: 1, end: 3 });
    const payload = h.last("jsonlEntries").payload;
    assert.equal(payload.requestId, 7, "the webview matches replies by requestId");
    assert.deepEqual(
      payload.entries.map((entry) => entry.index),
      [1, 2],
    );
    assert.equal(payload.entries[0].kind, "value");
  } finally {
    await h.cleanup();
  }
});

test("index: a malformed request is ignored instead of crashing the loop", async () => {
  const h = await harness(lines(2));
  try {
    await h.handlers.index(undefined);
    await h.handlers.index({ start: 0, end: 1 });
    await h.handlers.index({ requestId: "nope", start: 0, end: 1 });
    assert.deepEqual(h.types(), [], "nothing may be emitted for a bad request");
  } finally {
    await h.cleanup();
  }
});

test("index: a start past the end yields an empty page, not an error", async () => {
  const h = await harness(lines(2));
  try {
    await h.handlers.index({ requestId: 1, start: 99, end: 120 });
    assert.deepEqual(h.last("jsonlEntries").payload.entries, []);
  } finally {
    await h.cleanup();
  }
});

test("entry: a request for one line returns its parsed value", async () => {
  const h = await harness(lines(4));
  try {
    await h.handlers.entry({ requestId: 2, index: 3 });
    const payload = h.last("jsonlEntryData").payload;
    assert.equal(payload.requestId, 2);
    assert.equal(payload.index, 3);
    assert.equal(payload.entry.kind, "value");
    assert.deepEqual(payload.entry.value, { id: 3, msg: "row 3" });
  } finally {
    await h.cleanup();
  }
});

test("entry: a bad request emits nothing; a closed session is swallowed", async () => {
  const h = await harness(lines(2));
  try {
    await h.handlers.entry({ index: 0 });
    assert.deepEqual(h.types(), []);

    h.session.dispose();
    await h.handlers.entry({ requestId: 1, index: 0 });
    assert.deepEqual(
      h.types(),
      [],
      "a disposed session must not surface as an unhandled rejection",
    );
  } finally {
    await h.cleanup();
  }
});

test("search: every batch carries the requestId and the stream ends with done", async () => {
  const h = await harness(lines(200));
  try {
    h.handlers.search({ requestId: 5, query: "row 1" });
    await settle();
    const batches = h.emitted
      .filter((message) => message.type === "jsonlSearchBatch")
      .map((m) => m.payload);
    // A fast scan may report one batch; what has to hold is the correlation id and a
    // final batch, because the webview keeps its progress bar until `done` arrives.
    assert.ok(batches.length >= 1, "expected at least one batch");
    for (const batch of batches) assert.equal(batch.requestId, 5);
    const last = batches[batches.length - 1];
    assert.equal(last.done, true);
    assert.ok(last.entries.length > 0);
  } finally {
    await h.cleanup();
  }
});

test("search: a newer query supersedes the running one", async () => {
  const h = await harness(lines(60));
  try {
    h.handlers.search({ requestId: 1, query: "row" });
    h.handlers.search({ requestId: 2, query: "row 1" });
    await settle();
    const batches = h.emitted
      .filter((message) => message.type === "jsonlSearchBatch")
      .map((m) => m.payload);
    const finalOfFirst = batches.filter((batch) => batch.requestId === 1 && batch.done);
    assert.equal(
      finalOfFirst.length,
      0,
      "the superseded search must not report itself as complete once",
    );
    assert.ok(
      batches.some((batch) => batch.requestId === 2 && batch.done),
      "the newest search must finish",
    );
  } finally {
    await h.cleanup();
  }
});

test("search: cancelling stops the stream", async () => {
  const h = await harness(lines(200));
  try {
    h.handlers.search({ requestId: 1, query: "row" });
    h.handlers.cancelSearch({ requestId: 1 });
    await settle();
    const batches = h.emitted
      .filter((message) => message.type === "jsonlSearchBatch")
      .map((m) => m.payload);
    const finals = batches.filter((batch) => batch.done && batch.entries.length > 0);
    assert.equal(finals.length, 0, "a cancelled search reports no completed batch");
  } finally {
    await h.cleanup();
  }
});

test("reload: the session is replaced and the new document is announced", async () => {
  const h = await harness(lines(2));
  try {
    writeFileSync(h.path, lines(7));
    await h.handlers.reload();
    const info = h.last("jsonlInfo").payload;
    assert.equal(info.lineCount, 7, "the reload must re-read the file, not reuse the old index");

    await h.handlers.index({ requestId: 9, start: 6, end: 7 });
    assert.deepEqual(
      h.last("jsonlEntries").payload.entries.map((entry) => entry.index),
      [6],
    );
  } finally {
    await h.cleanup();
  }
});
