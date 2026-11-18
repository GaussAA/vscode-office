import assert from "node:assert/strict";
import test from "node:test";
import { createHostWorkbookTransport } from "@/react/view/excel/hostWorkbookTransport";

function eventBus() {
  const listeners = new Map<string, (content: any) => void>();
  const emitted: Array<{ type: string; payload: any }> = [];
  return {
    listeners,
    emitted,
    on(type: string, callback: (content: any) => void) {
      listeners.set(type, callback);
    },
    emit(type: string, payload: unknown) {
      emitted.push({ type, payload });
    },
  };
}

test("host workbook transport: open resolves the metadata on a hit", async () => {
  const bus = eventBus();
  const transport = createHostWorkbookTransport(bus, 50);
  const open = transport.open();
  const requestId = bus.emitted[0]?.payload.requestId;
  bus.listeners.get("excelWorkbookMeta")?.({
    requestId,
    key: "file:a.xlsx:1:2:1",
    sheets: [{ name: "Data", rowCount: 3, columnCount: 2 }],
  });
  assert.deepEqual(await open, {
    key: "file:a.xlsx:1:2:1",
    sheets: [{ name: "Data", rowCount: 3, columnCount: 2 }],
  });
});

test("host workbook transport: open resolves null on a miss and after the timeout", async () => {
  const bus = eventBus();
  const transport = createHostWorkbookTransport(bus, 20);
  const miss = transport.open();
  bus.listeners.get("excelWorkbookMeta")?.({
    requestId: bus.emitted[0]?.payload.requestId,
    missing: true,
  });
  assert.equal(await miss, null);

  const timedOut = transport.open();
  assert.equal(await timedOut, null);
});

test("host workbook transport: rows correlate and surface host errors", async () => {
  const bus = eventBus();
  const transport = createHostWorkbookTransport(bus, 50);
  const rows = transport.rows("key", 1, 2, 4);
  const requestId = bus.emitted[0]?.payload.requestId;
  assert.deepEqual(bus.emitted[0]?.payload, {
    requestId,
    key: "key",
    sheetIndex: 1,
    start: 2,
    end: 4,
  });
  bus.listeners.get("excelWorkbookRows")?.({
    requestId,
    rows: [["a"], ["b"]],
  });
  assert.deepEqual(await rows, [["a"], ["b"]]);

  const failing = transport.rows("key", 0, 0, 1);
  bus.listeners.get("excelWorkbookRows")?.({
    requestId: bus.emitted[1]?.payload.requestId,
    error: "cache gone",
  });
  await assert.rejects(failing, /cache gone/);
});

test("host workbook transport: dispose rejects pending reads and the store posts sheets", async () => {
  const bus = eventBus();
  const transport = createHostWorkbookTransport(bus, 50);
  const rows = transport.rows("key", 0, 0, 1);
  transport.dispose();
  await assert.rejects(rows, /closed/);

  transport.store([{ name: "Data", rows: [["x"]] }]);
  assert.equal(bus.emitted.at(-1)?.type, "excelWorkbookStore");
});
