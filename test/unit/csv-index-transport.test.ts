import assert from "node:assert/strict";
import test from "node:test";
import { createCsvIndexTransport } from "@/react/view/excel/csvIndexTransport";

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

test("csv index transport: open resolves a cached index", async () => {
  const bus = eventBus();
  const transport = createCsvIndexTransport(bus, 50);
  const open = transport.open();
  bus.listeners.get("excelCsvIndexMeta")?.({
    requestId: bus.emitted[0]?.payload.requestId,
    key: "file:a.csv:1:2:1",
    starts: [0, 5, 10],
    maxFields: 3,
  });
  assert.deepEqual(await open, {
    key: "file:a.csv:1:2:1",
    starts: [0, 5, 10],
    maxFields: 3,
  });
});

test("csv index transport: miss and timeout both resolve null", async () => {
  const bus = eventBus();
  const transport = createCsvIndexTransport(bus, 20);
  const miss = transport.open();
  bus.listeners.get("excelCsvIndexMeta")?.({
    requestId: bus.emitted[0]?.payload.requestId,
    missing: true,
  });
  assert.equal(await miss, null);
  assert.equal(await transport.open(), null);
});

test("csv index transport: store posts starts and maxFields", () => {
  const bus = eventBus();
  const transport = createCsvIndexTransport(bus, 50);
  transport.store({ starts: [0, 4], maxFields: 2 });
  assert.deepEqual(bus.emitted.at(-1), {
    type: "excelCsvIndexStore",
    payload: { starts: [0, 4], maxFields: 2 },
  });
});

test("csv index transport: dispose resolves pending opens as misses", async () => {
  const bus = eventBus();
  const transport = createCsvIndexTransport(bus, 50);
  const open = transport.open();
  transport.dispose();
  assert.equal(await open, null);
});
