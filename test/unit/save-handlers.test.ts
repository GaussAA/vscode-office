import assert from "node:assert/strict";
import test from "node:test";
import {
  INTERNAL_SAVE_CHANGE_WINDOW_MS,
  createSaveHandlers,
  createSaveTracker,
  saveTargetFor,
  type SaveTargetRequest,
} from "@/provider/saveHandlers";

const bytesOfText = (text: string) => Buffer.from(text, "utf8").toString("base64");

// ------------------------------------------------------------ the echo window

test("tracker: a change right after our own write is skipped, a later one is not", () => {
  let clock = 10_000;
  const saves = createSaveTracker(() => clock);
  saves.markSaved("file:///a.xlsx");

  clock += INTERNAL_SAVE_CHANGE_WINDOW_MS - 1;
  assert.equal(saves.shouldSkip("file:///a.xlsx"), true, "still inside the window");

  clock += 1;
  assert.equal(saves.shouldSkip("file:///a.xlsx"), false, "the window is exclusive at 1500 ms");
});

test("tracker: a document we never wrote is never skipped", () => {
  const saves = createSaveTracker(() => 5);
  assert.equal(saves.shouldSkip("file:///never.xlsx"), false);
});

test("tracker: a clock that reads 0 still counts as a recorded write", () => {
  const saves = createSaveTracker(() => 0);
  saves.markSaved("k");
  assert.equal(saves.shouldSkip("k"), true);
});

test("tracker: forget drops the entry when its panel goes away", () => {
  const saves = createSaveTracker(() => 1);
  saves.markSaved("k");
  saves.forget("k");
  assert.equal(saves.shouldSkip("k"), false);
});

test("tracker: two trackers do not see each other (no module-level state)", () => {
  const first = createSaveTracker(() => 1);
  const second = createSaveTracker(() => 1);
  first.markSaved("k");
  assert.equal(first.shouldSkip("k"), true);
  assert.equal(second.shouldSkip("k"), false);
});

// ------------------------------------------------------------ the default name

test("saveTargetFor: the base name keeps its stem and takes the requested extension", () => {
  const target = saveTargetFor("report", "CSV");
  assert.equal(target.ext, "csv", "the extension is lower-cased");
  assert.equal(target.defaultFileName, "report.csv");
  assert.deepEqual(target.filter, { label: "CSV (Comma delimited)", exts: ["csv"] });
});

test("saveTargetFor: no extension means xlsx", () => {
  const target = saveTargetFor("report");
  assert.equal(target.defaultFileName, "report.xlsx");
  assert.equal(target.filter.label, "Excel Workbook");
});

test("saveTargetFor: an unknown extension gets an upper-cased label, not a crash", () => {
  const target = saveTargetFor("report", "tsv");
  assert.deepEqual(target.filter, { label: "TSV", exts: ["tsv"] });
});

test("saveTargetFor: a name inherited from Object.prototype is not a format", () => {
  const target = saveTargetFor("report", "constructor");
  assert.deepEqual(target.filter, { label: "CONSTRUCTOR", exts: ["constructor"] });
});

// ------------------------------------------------------------ the routing

function harness(options: { readOnly?: boolean; picked?: string | undefined } = {}) {
  let clock = 1_000;
  const saves = createSaveTracker(() => clock);
  const log: string[] = [];
  const emitted: Array<{ type: string; payload?: any }> = [];
  const writes: Array<{ target: string; bytes: Uint8Array }> = [];
  const pickRequests: SaveTargetRequest[] = [];
  let readOnly = options.readOnly ?? false;
  let editVersion = 0;
  const handlers = createSaveHandlers<string>({
    document: "file:///dir/book.xlsx",
    baseName: "book",
    saves,
    keyOf: (target) => target,
    isReadOnly: () => readOnly,
    writeFile: async (target, bytes) => {
      // The stamp before the write is what makes an echo during the write skippable.
      log.push(`write(skip=${saves.shouldSkip(target)})`);
      writes.push({ target, bytes });
      clock += 40;
    },
    pickTarget: async (request) => {
      pickRequests.push(request);
      return options.picked;
    },
    markClean: (capturedVersion: number) => {
      if (editVersion === capturedVersion) {
        log.push("clean");
      }
    },
    getEditVersion: () => editVersion,
    openTarget: async (target) => {
      log.push(`open(${target})`);
    },
    emit: (type, payload) => emitted.push({ type, payload }),
  });
  return {
    handlers,
    saves,
    log,
    emitted,
    writes,
    pickRequests,
    setReadOnly: (value: boolean) => {
      readOnly = value;
    },
    advance: (ms: number) => {
      clock += ms;
    },
    edit: () => {
      editVersion += 1;
    },
  };
}

test("save: a read-only document rejects with saveFailed", async () => {
  const h = harness({ readOnly: true });
  await h.handlers.save({ contentBase64: bytesOfText("hello") });

  assert.equal(h.writes.length, 0, "a read-only file must not be written");
  // TOCTOU race: file became readonly between webview open and host save.
  // Host emits saveFailed so webview reverts pending-save → dirty.
  assert.equal(h.emitted.length, 1);
  assert.equal(h.emitted[0].type, "saveFailed");
  assert.deepEqual(h.emitted[0].payload, { reason: "readonly" });
  assert.equal(h.saves.shouldSkip("file:///dir/book.xlsx"), false, "nothing was written");
  assert.deepEqual(h.log, [], "the tab stays dirty");
});

test("save: readOnly is read at call time, not when the handlers were built", async () => {
  const h = harness({ readOnly: false });
  h.setReadOnly(true);
  await h.handlers.save("text");
  assert.equal(h.emitted[0]?.type, "saveFailed");
});

test("save: a normal save writes in place, stamps around the write, then reports done", async () => {
  const h = harness();
  await h.handlers.save("abc");

  assert.deepEqual(
    h.writes.map((write) => write.target),
    ["file:///dir/book.xlsx"],
  );
  assert.equal(new TextDecoder().decode(h.writes[0].bytes), "abc");
  assert.deepEqual(h.log, ["write(skip=true)", "clean"]);
  assert.deepEqual(
    h.emitted.map((message) => message.type),
    ["saveDone"],
  );
});

test("save: the window is measured from the end of the write, not from its start", async () => {
  const h = harness();
  await h.handlers.save("abc"); // the write itself takes 40 ms of the fake clock

  h.advance(INTERNAL_SAVE_CHANGE_WINDOW_MS - 1);
  assert.equal(h.saves.shouldSkip("file:///dir/book.xlsx"), true);
  h.advance(1);
  assert.equal(h.saves.shouldSkip("file:///dir/book.xlsx"), false);
});

test("saveAs: the dialog starts from the document name with the requested extension", async () => {
  const h = harness({ picked: undefined });
  await h.handlers.saveAs({ contentBase64: bytesOfText("x"), ext: "CSV" });

  assert.equal(h.pickRequests.length, 1);
  assert.equal(h.pickRequests[0].defaultFileName, "book.csv");
  assert.deepEqual(h.pickRequests[0].filters, { "CSV (Comma delimited)": ["csv"] });
});

test("saveAs: without an extension the default is xlsx", async () => {
  const h = harness({ picked: undefined });
  await h.handlers.saveAs({ contentBase64: bytesOfText("x") });
  assert.equal(h.pickRequests[0].defaultFileName, "book.xlsx");
});

test("saveAs: cancelling the dialog writes nothing and says nothing", async () => {
  const h = harness({ picked: undefined });
  await h.handlers.saveAs({ contentBase64: bytesOfText("x"), ext: "xlsx" });

  assert.equal(h.writes.length, 0);
  assert.deepEqual(h.emitted, []);
  assert.deepEqual(h.log, []);
  assert.equal(h.saves.shouldSkip("file:///dir/book.xlsx"), false);
});

test("saveAs: the picked target is stamped, the original document is not", async () => {
  const h = harness({ picked: "file:///elsewhere/copy.xlsx" });
  await h.handlers.saveAs({ contentBase64: bytesOfText("x"), ext: "xlsx" });

  assert.equal(h.saves.shouldSkip("file:///elsewhere/copy.xlsx"), true);
  assert.equal(
    h.saves.shouldSkip("file:///dir/book.xlsx"),
    false,
    "the document itself was not written, so its change events are real",
  );
  assert.deepEqual(
    h.writes.map((write) => write.target),
    ["file:///elsewhere/copy.xlsx"],
  );
});

test("saveAs: writes the target, then opens it", async () => {
  const h = harness({ picked: "file:///elsewhere/copy.xlsx" });
  await h.handlers.saveAs({ contentBase64: bytesOfText("x"), ext: "xlsx" });

  assert.deepEqual(h.log, ["write(skip=true)", "open(file:///elsewhere/copy.xlsx)"]);
});

test("saveAs: the document being edited is not marked clean and gets no saveDone", async () => {
  const h = harness({ picked: "file:///elsewhere/copy.xlsx" });
  await h.handlers.saveAs({ contentBase64: bytesOfText("x"), ext: "xlsx" });

  // Save As wrote a different file. The original still has its unsaved edits, so the tab keeps
  // its `*` and the webview must not be told "the save you asked for is done".
  assert.ok(!h.log.includes("clean"), "the original document was not saved");
  assert.deepEqual(
    h.emitted.map((message) => message.type),
    [],
  );
  assert.deepEqual(h.log, ["write(skip=true)", "open(file:///elsewhere/copy.xlsx)"]);
});
