import assert from "node:assert/strict";
import test from "node:test";
import type { OfficeOpenMessage } from "@/common/openPayload";
import {
  ExcelSession,
  loadErrorMessage,
  type ExcelLoadDeps,
  type ExcelLoadOutcome,
} from "@/react/view/excel/excelSession";
import { createWorkbookSheetSource } from "@/react/view/excel/workbookSource";

const MB = 1024 * 1024;

function payload(over: Partial<OfficeOpenMessage> = {}): OfficeOpenMessage {
  return {
    ext: ".csv",
    path: "vscode-webview://doc",
    fileName: "a.csv",
    scheme: "file",
    documentCacheId: "file:a",
    readOnly: false,
    size: 1024,
    ...over,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeDeps(over: Partial<ExcelLoadDeps> = {}): ExcelLoadDeps {
  return {
    loadBuffer: async () => new ArrayBuffer(0),
    loadWorkbookRows: async () => [],
    loadSheets: async () => ({ sheets: [], maxCols: 0 }),
    ...over,
  };
}

function csvBuffer(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

function expectLoad(result: ReturnType<ExcelSession["open"]>) {
  assert.equal(result.kind, "load");
  if (result.kind !== "load") throw new Error("unreachable");
  return result;
}

test("open: a small local file loads under a fresh generation", () => {
  const session = new ExcelSession();
  const first = expectLoad(session.open(payload()));
  const second = expectLoad(session.open(payload()));
  assert.ok(second.seq > first.seq);
  assert.equal(session.isCurrent(second.seq), true);
  assert.equal(session.isCurrent(first.seq), false);
  assert.equal(session.payload?.fileName, "a.csv");
  assert.equal(session.documentCacheId, "file:a");
});

test("open: an oversized document is guarded with the limit it missed", () => {
  const session = new ExcelSession();
  const result = session.open(payload({ ext: ".xlsx", fileName: "big.xlsx", size: 20 * MB }));
  assert.equal(result.kind, "guard");
  if (result.kind !== "guard") return;
  assert.deepEqual(result.tooLarge, {
    size: 20 * MB,
    name: "big.xlsx",
    ext: ".xlsx",
    limit: 15 * MB,
  });
});

test("open: a host-refused virtual document is guarded even when its size looks small", () => {
  const session = new ExcelSession();
  const result = session.open(payload({ scheme: "vscode-vfs", tooLarge: true, size: undefined }));
  assert.equal(result.kind, "guard");
  if (result.kind !== "guard") return;
  assert.equal(result.tooLarge.size, 0);
});

test("generation fence: a late result from an older open is discarded", async () => {
  const session = new ExcelSession();
  const slow = deferred<ArrayBuffer>();
  const oldOpen = expectLoad(session.open(payload({ documentCacheId: "file:old" })));
  const oldLoad = session.load(
    oldOpen.payload,
    oldOpen.seq,
    makeDeps({ loadBuffer: () => slow.promise }),
  );

  const newOpen = expectLoad(session.open(payload({ documentCacheId: "file:new" })));
  const newOutcome = await session.load(
    newOpen.payload,
    newOpen.seq,
    makeDeps({ loadSheets: async () => ({ sheets: [], maxCols: 7 }) }),
  );
  assert.equal(newOutcome.kind, "grid");

  slow.resolve(new ArrayBuffer(8));
  assert.deepEqual(await oldLoad, { kind: "stale" });
});

test("generation fence: an old open that fails late is stale, not an error", async () => {
  const session = new ExcelSession();
  const slow = deferred<ArrayBuffer>();
  const oldOpen = expectLoad(session.open(payload()));
  const oldLoad = session.load(
    oldOpen.payload,
    oldOpen.seq,
    makeDeps({ loadBuffer: () => slow.promise }),
  );
  session.open(payload());
  slow.reject(new Error("fetch failed"));
  assert.deepEqual(await oldLoad, { kind: "stale" });
});

test("generation fence: a new open that arrives while the grid is parsing wins", async () => {
  const session = new ExcelSession();
  const parsing = deferred<{ sheets: []; maxCols: number }>();
  const oldOpen = expectLoad(session.open(payload()));
  const oldLoad = session.load(
    oldOpen.payload,
    oldOpen.seq,
    makeDeps({ loadSheets: () => parsing.promise }),
  );
  // Let the buffer step finish so the load is parked inside loadSheets.
  await Promise.resolve();
  await Promise.resolve();
  session.open(payload());
  parsing.resolve({ sheets: [], maxCols: 1 });
  assert.deepEqual(await oldLoad, { kind: "stale" });
});

test("generation fence: a new open that arrives while a workbook is parsing wins", async () => {
  const session = new ExcelSession();
  const parsing = deferred<[]>();
  const oldOpen = expectLoad(session.open(payload({ ext: ".xlsx", size: 9 * MB })));
  const oldLoad = session.load(
    oldOpen.payload,
    oldOpen.seq,
    makeDeps({ loadWorkbookRows: () => parsing.promise }),
  );
  await Promise.resolve();
  await Promise.resolve();
  session.open(payload());
  parsing.resolve([]);
  assert.deepEqual(await oldLoad, { kind: "stale" });
});

test("generation fence: invalidate() supersedes every load in flight", async () => {
  const session = new ExcelSession();
  const slow = deferred<ArrayBuffer>();
  const open = expectLoad(session.open(payload()));
  const load = session.load(open.payload, open.seq, makeDeps({ loadBuffer: () => slow.promise }));
  session.invalidate();
  slow.resolve(new ArrayBuffer(0));
  assert.deepEqual(await load, { kind: "stale" });
  assert.equal(session.isCurrent(open.seq), false);
});

test("load: a failure under the current generation becomes an error outcome", async () => {
  const session = new ExcelSession();
  const open = expectLoad(session.open(payload()));
  const cause = new Error("bad zip");
  const outcome = await session.load(
    open.payload,
    open.seq,
    makeDeps({
      loadBuffer: async () => {
        throw cause;
      },
    }),
  );
  assert.deepEqual(outcome, { kind: "error", message: "bad zip", cause });
});

test("load: a parser failure under the current generation becomes an error outcome", async () => {
  const session = new ExcelSession();
  const open = expectLoad(session.open(payload()));
  const outcome = await session.load(
    open.payload,
    open.seq,
    makeDeps({
      loadSheets: async () => {
        throw new Error("corrupt");
      },
    }),
  );
  assert.equal(outcome.kind, "error");
  assert.equal((outcome as Extract<ExcelLoadOutcome, { kind: "error" }>).message, "corrupt");
});

test("load: a host workbook hit skips the buffer and the parser", async () => {
  const session = new ExcelSession();
  const open = expectLoad(
    session.open(payload({ ext: ".xlsx", fileName: "big.xlsx", size: 9 * MB, hostWorkbook: true })),
  );
  let bufferCalls = 0;
  let parseCalls = 0;
  const source = createWorkbookSheetSource([{ name: "Data", rows: [["id"], ["1"]] }]);
  const outcome = await session.load(
    open.payload,
    open.seq,
    makeDeps({
      loadBuffer: async () => {
        bufferCalls++;
        return new ArrayBuffer(0);
      },
      loadWorkbookRows: async () => {
        parseCalls++;
        return [];
      },
      loadHostWorkbook: async () => source,
    }),
  );
  assert.equal(outcome.kind, "workbook");
  assert.equal((outcome as Extract<ExcelLoadOutcome, { kind: "workbook" }>).source, source);
  assert.equal(bufferCalls, 0);
  assert.equal(parseCalls, 0);
});

test("load: a host workbook miss falls back and stores the parsed rows", async () => {
  const session = new ExcelSession();
  const open = expectLoad(
    session.open(payload({ ext: ".xlsx", fileName: "big.xlsx", size: 9 * MB, hostWorkbook: true })),
  );
  const parsed = [{ name: "Data", rows: [["id"], ["1"]] }];
  let stored: unknown = null;
  const outcome = await session.load(
    open.payload,
    open.seq,
    makeDeps({
      loadBuffer: async () => new ArrayBuffer(0),
      loadWorkbookRows: async () => parsed,
      loadHostWorkbook: async () => null,
      storeHostWorkbook: (_payload, sheets) => {
        stored = sheets;
      },
    }),
  );
  assert.equal(outcome.kind, "workbook");
  assert.equal(stored, parsed);
});

test("loadErrorMessage: Error, empty message, string and nullish causes", () => {
  assert.equal(loadErrorMessage(new Error("x")), "x");
  assert.equal(loadErrorMessage(new Error("")), "Error");
  assert.equal(loadErrorMessage("plain"), "plain");
  assert.equal(loadErrorMessage(null), "null");
  assert.equal(loadErrorMessage(undefined), "undefined");
});

test("load: a small file goes to the editable grid", async () => {
  const session = new ExcelSession();
  const open = expectLoad(session.open(payload()));
  const data = { sheets: [], maxCols: 3 };
  const outcome = await session.load(
    open.payload,
    open.seq,
    makeDeps({ loadSheets: async () => data }),
  );
  assert.deepEqual(outcome, { kind: "grid", data });
});

test("load: a large workbook is windowed through its sheet picker", async () => {
  const session = new ExcelSession();
  const open = expectLoad(session.open(payload({ ext: ".xlsx", size: 9 * MB })));
  const outcome = await session.load(
    open.payload,
    open.seq,
    makeDeps({
      loadWorkbookRows: async () => [
        { name: "One", rows: [["h"], ["a"]] },
        { name: "Two", rows: [["h"]] },
      ],
    }),
  );
  assert.equal(outcome.kind, "workbook");
  if (outcome.kind !== "workbook") return;
  assert.deepEqual(outcome.source.sheetNames, ["One", "Two"]);
  assert.equal(outcome.source.sheetIndex, 0);
  assert.equal(outcome.source.rowCount, 2);
});

test("load: a large text file is windowed without parsing it into the grid", async () => {
  const session = new ExcelSession();
  const open = expectLoad(session.open(payload({ ext: ".csv", size: 9 * MB })));
  let gridParsed = false;
  const outcome = await session.load(
    open.payload,
    open.seq,
    makeDeps({
      loadBuffer: async () => csvBuffer("h1,h2\na,b\nc,d\n"),
      loadSheets: async () => {
        gridParsed = true;
        return { sheets: [], maxCols: 0 };
      },
    }),
  );
  assert.equal(outcome.kind, "text");
  assert.equal(gridParsed, false);
  if (outcome.kind !== "text") return;
  assert.equal(outcome.source.columnCount, 2);
  assert.deepEqual(await outcome.source.readRows(0, 1), [["h1", "h2"]]);
});

test("open anyway: lifts the guard for the current document and starts a new generation", () => {
  const session = new ExcelSession();
  const guarded = session.open(payload({ ext: ".xlsx", size: 20 * MB }));
  assert.equal(guarded.kind, "guard");
  assert.equal(session.isForced, false);

  const forced = session.openAnyway();
  assert.equal(forced?.kind, "load");
  if (forced?.kind !== "load") return;
  assert.equal(session.isForced, true);
  assert.equal(forced.payload.size, 20 * MB);
  assert.ok(forced.seq > (guarded as { seq: number }).seq);
  assert.equal(session.isCurrent(forced.seq), true);
});

test("open anyway: before any document has arrived it does nothing", () => {
  const session = new ExcelSession();
  assert.equal(session.openAnyway(), null);
  assert.equal(session.isForced, false);
});

test("open anyway: a refused virtual document without bytes asks the host to send them", () => {
  const session = new ExcelSession();
  session.open(payload({ scheme: "vscode-vfs", tooLarge: true, size: undefined }));
  assert.deepEqual(session.openAnyway(), { kind: "request-force" });
  assert.equal(session.isForced, true);
});

test("open anyway: a virtual document that already carries bytes loads from them", () => {
  const session = new ExcelSession();
  session.open(
    payload({ scheme: "vscode-vfs", ext: ".xlsx", size: 20 * MB, bufferBase64: "AAAA" }),
  );
  assert.equal(session.openAnyway()?.kind, "load");
});

test("open anyway: supersedes a load that was already in flight", async () => {
  const session = new ExcelSession();
  const slow = deferred<ArrayBuffer>();
  const first = expectLoad(session.open(payload()));
  const inFlight = session.load(
    first.payload,
    first.seq,
    makeDeps({ loadBuffer: () => slow.promise }),
  );
  session.openAnyway();
  slow.resolve(new ArrayBuffer(0));
  assert.deepEqual(await inFlight, { kind: "stale" });
});

test("forced: the host's answer to openForce (same document) is not guarded again", () => {
  const session = new ExcelSession();
  const refused = payload({
    scheme: "vscode-vfs",
    ext: ".xlsx",
    size: 20 * MB,
    tooLarge: true,
    documentCacheId: "vfs:big",
  });
  assert.equal(session.open(refused).kind, "guard");
  session.openAnyway();

  // The host re-sends `open` for the same document, now with bytes and without `tooLarge`.
  const answer = payload({
    scheme: "vscode-vfs",
    ext: ".xlsx",
    size: 20 * MB,
    documentCacheId: "vfs:big",
    bufferBase64: "AAAA",
  });
  assert.equal(session.open(answer).kind, "load");
  assert.equal(session.isForced, true);
});

test("forced: only the current document is forced; a different document starts guarded", () => {
  const session = new ExcelSession();
  const big = (documentCacheId: string) =>
    payload({ ext: ".xlsx", size: 20 * MB, documentCacheId });

  assert.equal(session.open(big("file:one")).kind, "guard");
  session.openAnyway();
  assert.equal(session.open(big("file:one")).kind, "load");

  assert.equal(session.open(big("file:two")).kind, "guard");
  assert.equal(session.isForced, false);

  // Coming back to the first document does not remember the earlier answer either.
  assert.equal(session.open(big("file:one")).kind, "guard");
});

test("forced: only lifts the guard, the view is still chosen by size", async () => {
  const session = new ExcelSession();
  // 30 MB virtual CSV: over the 25 MB inline limit, so "refused" rather than "window".
  const refused = payload({ scheme: "vscode-vfs", size: 30 * MB, tooLarge: true });
  session.open(refused);
  const forced = session.openAnyway();
  assert.equal(forced?.kind, "request-force");

  const answer = payload({ scheme: "vscode-vfs", size: 30 * MB, bufferBase64: "AAAA" });
  const reopened = expectLoad(session.open(answer));
  let gridParsed = false;
  const outcome = await session.load(
    reopened.payload,
    reopened.seq,
    makeDeps({
      loadSheets: async () => {
        gridParsed = true;
        return { sheets: [], maxCols: 0 };
      },
    }),
  );
  assert.equal(outcome.kind, "grid");
  assert.equal(gridParsed, true);
});
