import assert from "node:assert/strict";
import test from "node:test";
import { promises as fsp } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { CSV_INDEX_VERSION, CsvIndexCache, csvIndexCacheKey } from "@/service/csvIndexCache";

async function temporaryRoot(t: test.TestContext): Promise<string> {
  const root = await fsp.mkdtemp(path.join(tmpdir(), "csv-index-cache-"));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  return root;
}

const fingerprint = { key: "file:///data/a.csv", size: 100, mtimeMs: 123 };

test("csv index cache: starts and maxFields round-trip", async (t) => {
  const root = await temporaryRoot(t);
  const cache = new CsvIndexCache(root);
  const index = { starts: [0, 12, 40], maxFields: 4 };
  assert.equal(await cache.set(fingerprint, index), true);
  assert.deepEqual(await cache.get(fingerprint), index);
});

test("csv index cache: an empty file stores an empty index", async (t) => {
  const root = await temporaryRoot(t);
  const cache = new CsvIndexCache(root);
  const empty = { ...fingerprint, size: 0 };
  const index = { starts: [], maxFields: 0 };
  assert.equal(await cache.set(empty, index), true);
  assert.deepEqual(await cache.get(empty), index);
});

test("csv index cache: changed size or mtime misses and removes the entry", async (t) => {
  const root = await temporaryRoot(t);
  const cache = new CsvIndexCache(root);
  await cache.set(fingerprint, { starts: [0, 12], maxFields: 2 });
  assert.equal(await cache.get({ ...fingerprint, size: 101 }), null);
  assert.equal(await cache.get({ ...fingerprint, mtimeMs: 124 }), null);
  assert.deepEqual(await fsp.readdir(root), []);
});

test("csv index cache: an out-of-range or non-increasing index is rejected on write", async (t) => {
  const root = await temporaryRoot(t);
  const cache = new CsvIndexCache(root);
  assert.equal(await cache.set(fingerprint, { starts: [5, 12], maxFields: 2 }), false);
  assert.equal(await cache.set(fingerprint, { starts: [0, 0], maxFields: 2 }), false);
  assert.equal(await cache.set(fingerprint, { starts: [0, 100], maxFields: 2 }), false);
  assert.equal(await cache.set(fingerprint, { starts: [0, 12], maxFields: -1 }), false);
  assert.deepEqual(await fsp.readdir(root), []);
});

test("csv index cache: a truncated payload is a miss and removes the entry", async (t) => {
  const root = await temporaryRoot(t);
  const cache = new CsvIndexCache(root);
  await cache.set(fingerprint, { starts: [0, 12, 40], maxFields: 2 });
  const payloadName = (await fsp.readdir(root)).find((name) => name.endsWith(".bin"));
  assert.ok(payloadName);
  await fsp.writeFile(path.join(root, payloadName), new Uint8Array(4));
  assert.equal(await cache.get(fingerprint), null);
  assert.deepEqual(await fsp.readdir(root), []);
});

test("csv index cache: key includes the version and clear removes every file", async (t) => {
  assert.match(csvIndexCacheKey(fingerprint), new RegExp(`:${CSV_INDEX_VERSION}$`));
  const root = await temporaryRoot(t);
  const cache = new CsvIndexCache(root);
  await cache.set(fingerprint, { starts: [0], maxFields: 1 });
  await cache.clear();
  assert.deepEqual(await fsp.readdir(root), []);
});
