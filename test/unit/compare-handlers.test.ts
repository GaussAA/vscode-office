import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createCompareHandlers, type CompareSideContext } from "@/provider/compareHandlers";
import type { ByteSource } from "@/common/byteSource";
import { memoryByteSource } from "@/service/jsonlFile";

const fixture = (name: string) => new URL(`../fixtures/parquet/${name}.parquet`, import.meta.url);

async function bytesOf(name: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(fixture(name)));
}

/** A side backed by memory bytes; `closes` counts how often its source was released. */
function side(fileName: string, bytes: Uint8Array) {
  const state = { opens: 0, closes: 0 };
  const context: CompareSideContext = {
    fileName,
    open: async () => {
      state.opens++;
      const source: ByteSource = {
        ...memoryByteSource(bytes),
        close: () => {
          state.closes++;
        },
      };
      return source;
    },
  };
  return { context, state };
}

/** A side whose open itself fails: the file moved, or the remote is unreachable. */
function brokenSide(fileName: string, message: string) {
  const state = { opens: 0, closes: 0 };
  const context: CompareSideContext = {
    fileName,
    open: async () => {
      state.opens++;
      throw new Error(message);
    },
  };
  return { context, state };
}

function harness(left: CompareSideContext, right: CompareSideContext) {
  const emitted: Array<{ type: string; payload: any }> = [];
  const handlers = createCompareHandlers({
    left,
    right,
    emit: (type, payload) => emitted.push({ type, payload }),
  });
  return { handlers, emitted };
}

test("init: two readable files are answered with a comparison addressed to request 0", async () => {
  const left = side("old.parquet", await bytesOf("multigroup"));
  const right = side("new.parquet", await bytesOf("single-row"));
  const { handlers, emitted } = harness(left.context, right.context);

  await handlers.init();

  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].type, "compareData");
  assert.equal(emitted[0].payload.requestId, 0);
  assert.equal(emitted[0].payload.failedSide, undefined);
  assert.equal(emitted[0].payload.error, undefined);
  assert.equal(emitted[0].payload.compare.left.fileName, "old.parquet");
  assert.equal(emitted[0].payload.compare.right.fileName, "new.parquet");
  assert.equal(emitted[0].payload.compare.left.rowCount, 3000);
});

test("reload: the caller's requestId is echoed", async () => {
  const left = side("a.parquet", await bytesOf("multigroup"));
  const right = side("b.parquet", await bytesOf("multigroup"));
  const { handlers, emitted } = harness(left.context, right.context);

  await handlers.reload({ requestId: 12 });

  assert.equal(emitted[0].payload.requestId, 12);
});

test("reload: a request without a numeric requestId is addressed to 0", async () => {
  const left = side("a.parquet", await bytesOf("multigroup"));
  const right = side("b.parquet", await bytesOf("multigroup"));
  const { handlers, emitted } = harness(left.context, right.context);

  await handlers.reload(undefined);
  await handlers.reload({});
  await handlers.reload({ requestId: "3" as unknown as number });

  assert.deepEqual(
    emitted.map((message) => message.payload.requestId),
    [0, 0, 0],
  );
});

test("a failure on the left side only: the left file is named and the right is never opened", async () => {
  const left = brokenSide("old.parquet", "ENOENT: old.parquet");
  const right = side("new.parquet", await bytesOf("multigroup"));
  const { handlers, emitted } = harness(left.context, right.context);

  await handlers.reload({ requestId: 5 });

  assert.equal(emitted.length, 1, "a failure still answers");
  assert.deepEqual(emitted[0].payload, {
    requestId: 5,
    compare: null,
    failedSide: "left",
    error: "ENOENT: old.parquet",
  });
  assert.equal(right.state.opens, 0, "once the left has failed there is nothing to compare");
});

test("a failure on the right side only: the right file is named and the left is released", async () => {
  const left = side("old.parquet", await bytesOf("multigroup"));
  const right = brokenSide("new.parquet", "EACCES: new.parquet");
  const { handlers, emitted } = harness(left.context, right.context);

  await handlers.reload({ requestId: 6 });

  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].payload.failedSide, "right");
  assert.equal(emitted[0].payload.compare, null);
  assert.equal(emitted[0].payload.requestId, 6);
  assert.equal(emitted[0].payload.error, "EACCES: new.parquet");
  assert.equal(left.state.closes, 1, "the side that did read must not leak its handle");
});

test("a right side that opens but is not parquet is reported as the right side", async () => {
  const left = side("old.parquet", await bytesOf("multigroup"));
  const right = side(
    "notes.parquet",
    new TextEncoder().encode("This is not a valid parquet file\n"),
  );
  const { handlers, emitted } = harness(left.context, right.context);

  await handlers.init();

  assert.equal(emitted[0].payload.failedSide, "right");
  assert.equal(emitted[0].payload.compare, null);
  assert.ok(emitted[0].payload.error.length > 0, "the footer error travels with the reply");
  assert.equal(right.state.closes, 1, "a source that failed to parse is still closed");
});

test("when both sides fail, only the left one is reported", async () => {
  const left = brokenSide("old.parquet", "left is gone");
  const right = brokenSide("new.parquet", "right is gone");
  const { handlers, emitted } = harness(left.context, right.context);

  await handlers.init();

  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].payload.failedSide, "left");
  assert.equal(emitted[0].payload.error, "left is gone");
});

test("a rejection that is not an Error is reported as text", async () => {
  const left: CompareSideContext = {
    fileName: "x.parquet",
    open: async () => {
      throw "plain string";
    },
  };
  const right = side("y.parquet", await bytesOf("multigroup"));
  const { handlers, emitted } = harness(left, right.context);

  await handlers.init();

  assert.equal(emitted[0].payload.error, "plain string");
});

test("every source that was opened is closed on success", async () => {
  const left = side("a.parquet", await bytesOf("multigroup"));
  const right = side("b.parquet", await bytesOf("single-row"));
  const { handlers } = harness(left.context, right.context);

  await handlers.init();

  assert.deepEqual([left.state.closes, right.state.closes], [1, 1]);
});

test("each answer reads both sides again: a reload sees the files as they are now", async () => {
  const left = side("a.parquet", await bytesOf("multigroup"));
  const right = side("b.parquet", await bytesOf("multigroup"));
  const { handlers } = harness(left.context, right.context);

  await handlers.init();
  await handlers.reload({ requestId: 1 });

  assert.deepEqual([left.state.opens, right.state.opens], [2, 2]);
});
