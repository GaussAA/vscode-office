import assert from "node:assert/strict";
import test from "node:test";
import { parquetWriteBuffer } from "hyparquet-writer";
import { createParquetHandlers } from "@/provider/parquetHandlers";
import type { ByteSource } from "@/common/byteSource";

function generated(): Uint8Array {
  return new Uint8Array(
    parquetWriteBuffer({
      columnData: [
        { name: "id", data: Int32Array.from([1, 2, 3, 4, 5]), type: "INT32" },
        { name: "name", data: ["alpha", "beta", "gamma", "alpha-2", "delta"], type: "STRING" },
        { name: "note", data: ["x", "needle-here", "y", "z", "needle-too"], type: "STRING" },
      ],
    }),
  );
}

function memorySource(bytes: Uint8Array): ByteSource {
  return {
    size: bytes.byteLength,
    read: async (offset, length) => bytes.subarray(offset, offset + length),
  };
}

function harness(bytes: Uint8Array) {
  const emitted: Array<{ type: string; payload: any }> = [];
  let opens = 0;
  let closes = 0;
  const source = memorySource(bytes);
  const handlers = createParquetHandlers({
    openSource: async () => {
      opens += 1;
      return {
        ...source,
        close: () => {
          closes += 1;
        },
      };
    },
    emit: (type, payload) => emitted.push({ type, payload }),
  });
  return {
    handlers,
    emitted,
    stats: () => ({ opens, closes }),
    data: () => emitted.filter((message) => message.type === "parquetSearchData"),
  };
}

test("host search: answers with the request id, hit rows and column scope", async () => {
  const { handlers, emitted, stats, data } = harness(generated());

  await handlers.search({ requestId: 7, query: "needle", columns: [2] });

  assert.equal(data().length, 1);
  const payload = data()[0]?.payload;
  assert.equal(payload.requestId, 7);
  assert.deepEqual(payload.rows, [1, 4]);
  assert.deepEqual(payload.columns, [2, 2]);
  assert.equal(payload.cancelled, false);
  assert.equal(payload.rowCount, 5);
  assert.equal(stats().opens, 1);
  assert.equal(stats().closes, 1, "the per-request source must not leak");
  assert.ok(
    emitted.some((message) => message.type === "parquetSearchProgress"),
    "a scan must report progress",
  );
});

test("host search: the same query and scope is answered from the host memo", async () => {
  const { handlers, data, stats } = harness(generated());

  await handlers.search({ requestId: 1, query: "needle", columns: [2] });
  await handlers.search({ requestId: 2, query: "  NEEDLE ", columns: [2] });

  assert.equal(data().length, 2);
  assert.equal(stats().opens, 1, "the second request should not re-open the file");
  assert.equal(data()[1]?.payload.rows[0], 1);
});

test("host search: a different scope is a different memo entry", async () => {
  const { handlers, data, stats } = harness(generated());

  await handlers.search({ requestId: 1, query: "alpha" });
  await handlers.search({ requestId: 2, query: "alpha", columns: [1] });

  assert.equal(data().length, 2);
  assert.equal(stats().opens, 2, "the scope is part of the cache key");
  assert.deepEqual(data()[0]?.payload.columns, [1, 1]);
});

test("host search: cancelling the running id answers cancelled and caches nothing", async () => {
  const { handlers, data, stats } = harness(generated());

  const running = handlers.search({ requestId: 4, query: "needle" });
  handlers.cancelSearch({ requestId: 4 });
  await running;

  assert.equal(data().length, 1);
  assert.equal(data()[0]?.payload.cancelled, true);
  assert.deepEqual(data()[0]?.payload.rows, []);
  await handlers.search({ requestId: 5, query: "needle" });
  assert.equal(stats().opens, 2, "a cancelled result must not enter the memo");
});

test("host search: clearing the cache forces a fresh scan", async () => {
  const { handlers, stats } = harness(generated());

  await handlers.search({ requestId: 1, query: "needle" });
  handlers.clearSearchCache();
  await handlers.search({ requestId: 2, query: "needle" });

  assert.equal(stats().opens, 2, "a cleared memo must not answer the next search");
});

test("host search: a bad file answers with an error instead of throwing", async () => {
  const { handlers, data } = harness(new TextEncoder().encode("not a parquet file"));

  await handlers.search({ requestId: 9, query: "anything" });

  assert.equal(data().length, 1);
  assert.equal(data()[0]?.payload.rows, null);
  assert.match(String(data()[0]?.payload.error), /footer != PAR1/);
});
