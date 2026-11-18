import assert from "node:assert/strict";
import test from "node:test";
import {
  createJsonlHandlers,
  type JsonlHandlerContext,
  type ReopenOptions,
} from "@/provider/jsonlHandlers";

/**
 * Minimal test harness for handlers with mocked session/reopen.
 * Tests the new lazy-loading and progress-reporting logic without real files.
 */
function mockHandlers(
  sessionValue: any = null,
  reopenImpl?: (opts?: ReopenOptions) => Promise<void>,
) {
  const emitted: Array<{ type: string; payload: unknown }> = [];
  let currentSession = sessionValue;

  const context: JsonlHandlerContext = {
    session: () => currentSession,
    reopen: reopenImpl ?? (async () => {}),
    emit: (type, payload) => emitted.push({ type, payload }),
    info: () => ({
      fileName: "test.jsonl",
      cacheId: "test:cache",
      lineCount: currentSession?.lineCount ?? 0,
      byteSize: currentSession?.byteSize ?? 0,
    }),
  };

  return {
    handlers: createJsonlHandlers(context),
    emitted,
    setSession: (s: any) => {
      currentSession = s;
    },
    last: (type: string) => {
      const hit = [...emitted].reverse().find((m) => m.type === type);
      if (!hit) throw new Error(`no ${type} message emitted`);
      return hit.payload;
    },
  };
}

test("handlers: init calls reopen when session is null", async () => {
  let reopenCalled = false;
  const h = mockHandlers(null, async () => {
    reopenCalled = true;
  });

  await h.handlers.init();
  assert.ok(reopenCalled, "reopen should be called");
});

test("handlers: init with requestId passes it to progress and info", async () => {
  const h = mockHandlers(null, async (opts?: ReopenOptions) => {
    opts?.onProgress?.(100, 200);
    opts?.onProgress?.(200, 200);
    h.setSession({ lineCount: 5, byteSize: 200 });
  });

  await h.handlers.init({ requestId: 42 });
  const progressMsgs = h.emitted.filter((m) => m.type === "jsonlIndexProgress");
  assert.equal(progressMsgs.length, 2);
  assert.deepEqual(progressMsgs[0].payload, { requestId: 42, loaded: 100, total: 200 });
  const info = h.last("jsonlInfo") as any;
  assert.equal(info.requestId, 42);
});

test("handlers: reload with requestId reports progress", async () => {
  const h = mockHandlers({ lineCount: 3, byteSize: 100 }, async (opts?: ReopenOptions) => {
    opts?.onProgress?.(50, 100);
  });

  await h.handlers.reload({ requestId: 99 });
  const progressMsgs = h.emitted.filter((m) => m.type === "jsonlIndexProgress");
  assert.equal(progressMsgs.length, 1);
  assert.equal((progressMsgs[0].payload as any).requestId, 99);
  const info = h.last("jsonlInfo") as any;
  assert.equal(info.requestId, 99);
});

test("handlers: index returns empty when session is null", async () => {
  const h = mockHandlers(null);
  await h.handlers.index({ requestId: 1, start: 0, end: 10 });
  const entries = h.last("jsonlEntries") as any;
  assert.equal(entries.requestId, 1);
  assert.deepEqual(entries.entries, []);
});

test("handlers: entry returns null when session is null", async () => {
  const h = mockHandlers(null);
  await h.handlers.entry({ requestId: 1, index: 0 });
  const entry = h.last("jsonlEntryData") as any;
  assert.equal(entry.requestId, 1);
  assert.equal(entry.entry, null);
});

test("handlers: search returns empty done batch when session is null", async () => {
  const h = mockHandlers(null);
  h.handlers.search({ requestId: 1, query: "test" });
  const batch = h.last("jsonlSearchBatch") as any;
  assert.equal(batch.requestId, 1);
  assert.equal(batch.done, true);
  assert.deepEqual(batch.entries, []);
});

test("handlers: init without requestId omits it from progress", async () => {
  const h = mockHandlers(null, async (opts?: ReopenOptions) => {
    opts?.onProgress?.(100, 200);
    h.setSession({ lineCount: 2, byteSize: 200 });
  });

  await h.handlers.init();
  const progressMsgs = h.emitted.filter((m) => m.type === "jsonlIndexProgress");
  assert.equal(progressMsgs.length, 0, "no progress when requestId is undefined");
});
