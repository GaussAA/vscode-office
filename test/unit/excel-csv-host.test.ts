import assert from "node:assert/strict";
import test from "node:test";
import { promises as fsp } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createExcelCsvHost } from "@/provider/excelCsvHost";
import { CsvIndexCache } from "@/service/csvIndexCache";

async function temporaryRoot(t: test.TestContext): Promise<string> {
  const root = await fsp.mkdtemp(path.join(tmpdir(), "excel-csv-host-"));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  return root;
}

function harness(
  root: string,
  stat: { size: number; mtimeMs: number } | null = { size: 100, mtimeMs: 1 },
) {
  const cache = new CsvIndexCache(root);
  const emitted: Array<{ type: string; payload: any }> = [];
  let current = stat;
  const host = createExcelCsvHost({
    documentCacheId: "file:a.csv",
    cache,
    stat: async () => current,
    emit: (type, payload) => emitted.push({ type, payload }),
  });
  return {
    host,
    cache,
    emitted,
    setStat: (value: { size: number; mtimeMs: number } | null) => (current = value),
  };
}

test("excel csv host: miss, store, then the next open returns the index", async (t) => {
  const root = await temporaryRoot(t);
  const { host, emitted } = harness(root);
  await host.open({ requestId: 1 });
  assert.equal(emitted[0]?.payload.missing, true);

  assert.equal(await host.store({ starts: [0, 12, 40], maxFields: 3 }), true);
  assert.deepEqual(await host.open({ requestId: 2 }), {
    key: emitted.at(-1)?.payload.key,
    starts: [0, 12, 40],
    maxFields: 3,
  });
  assert.equal(emitted.at(-1)?.payload.missing, undefined);
});

test("excel csv host: a changed fingerprint misses the old entry", async (t) => {
  const root = await temporaryRoot(t);
  const { host, emitted, setStat } = harness(root);
  await host.store({ starts: [0, 12], maxFields: 2 });
  setStat({ size: 101, mtimeMs: 2 });
  await host.open({ requestId: 3 });
  assert.equal(emitted.at(-1)?.payload.missing, true);
});

test("excel csv host: invalid stores and missing stat are ignored", async (t) => {
  const root = await temporaryRoot(t);
  const { host, setStat } = harness(root);
  assert.equal(await host.store({ starts: "bad" as unknown as number[], maxFields: 2 }), false);
  assert.equal(await host.store({ starts: [0, 12], maxFields: -1 }), false);

  setStat(null);
  assert.equal(await host.store({ starts: [0, 12], maxFields: 2 }), false);
});

test("excel csv host: the returned index and key match the cache entry", async (t) => {
  const root = await temporaryRoot(t);
  const { host } = harness(root);
  await host.store({ starts: [0, 12], maxFields: 2 });
  const index = await host.open({ requestId: 4 });
  assert.ok(index);
  assert.deepEqual(
    { starts: index.starts, maxFields: index.maxFields },
    { starts: [0, 12], maxFields: 2 },
  );
  assert.match(index.key, /^file:a\.csv:100:1:/);
});
