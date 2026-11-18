import assert from "node:assert/strict";
import test from "node:test";
import { promises as fsp } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { HostDiskCache } from "@/service/hostDiskCache";

const MB = 1024 * 1024;

async function temporaryRoot(t: test.TestContext): Promise<string> {
  const root = await fsp.mkdtemp(path.join(tmpdir(), "host-disk-cache-"));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  return root;
}

function makeStore(
  root: string,
  overrides: Partial<ConstructorParameters<typeof HostDiskCache>[1]> = {},
  now: () => number = Date.now,
) {
  return new HostDiskCache(root, {
    maxEntryBytes: 4 * MB,
    maxTotalBytes: 64 * MB,
    maxEntries: 5,
    ttlMs: 7 * 24 * 60 * 60 * 1000,
    now,
    ...overrides,
  });
}

async function entryNames(root: string): Promise<string[]> {
  try {
    return await fsp.readdir(root);
  } catch {
    return [];
  }
}

test("host disk cache: stores metadata and payload, then reads them back", async (t) => {
  const root = await temporaryRoot(t);
  const store = makeStore(root);
  const payload = new TextEncoder().encode("offsets");
  assert.equal(await store.set("doc:one", 1, { size: 123, lineCount: 4 }, payload), true);

  const hit = await store.get("doc:one", 1);
  assert.ok(hit);
  assert.deepEqual(hit.meta.data, { size: 123, lineCount: 4 });
  assert.equal(hit.meta.bytes, payload.byteLength);
  assert.equal(hit.payload.toString(), "offsets");
});

test("host disk cache: a version mismatch is a miss and removes the entry", async (t) => {
  const root = await temporaryRoot(t);
  const store = makeStore(root);
  await store.set("doc:one", 1, {}, new Uint8Array([1, 2, 3]));
  assert.equal(await store.get("doc:one", 2), null);
  assert.deepEqual(await entryNames(root), []);
});

test("host disk cache: expired entries are removed on read", async (t) => {
  const root = await temporaryRoot(t);
  let now = 1_000;
  const store = makeStore(root, { ttlMs: 100 }, () => now);
  await store.set("doc:one", 1, {}, new Uint8Array([1]));
  now += 101;
  assert.equal(await store.get("doc:one", 1), null);
  assert.deepEqual(await entryNames(root), []);
});

test("host disk cache: evicts the least recently used entry under the count cap", async (t) => {
  const root = await temporaryRoot(t);
  let now = 1_000;
  const store = makeStore(root, { maxEntries: 2 }, () => now);
  await store.set("a", 1, {}, new Uint8Array([1]));
  now++;
  await store.set("b", 1, {}, new Uint8Array([2]));
  now++;
  assert.ok(await store.get("a", 1), "reading a should refresh its LRU position");
  now++;
  await store.set("c", 1, {}, new Uint8Array([3]));

  assert.ok(await store.get("a", 1), "a was refreshed and must survive");
  assert.equal(await store.get("b", 1), null, "b was the least recently used");
  assert.ok(await store.get("c", 1));
});

test("host disk cache: evicts under the total byte budget", async (t) => {
  const root = await temporaryRoot(t);
  const store = makeStore(root, { maxTotalBytes: 12, maxEntryBytes: 64 });
  await store.set("a", 1, {}, new Uint8Array(6));
  await new Promise((resolve) => setTimeout(resolve, 10)); // ensure different timestamps
  await store.set("b", 1, {}, new Uint8Array(6));
  await new Promise((resolve) => setTimeout(resolve, 10));
  await store.set("c", 1, {}, new Uint8Array(6));

  assert.equal(await store.get("a", 1), null);
  assert.ok(await store.get("b", 1), "b still fits after the oldest entry is evicted");
  assert.ok(await store.get("c", 1));
});

test("host disk cache: refuses an entry over the per-entry cap", async (t) => {
  const root = await temporaryRoot(t);
  const store = makeStore(root, { maxEntryBytes: 4 });
  assert.equal(await store.set("large", 1, {}, new Uint8Array(5)), false);
  assert.deepEqual(await entryNames(root), []);
});

test("host disk cache: a truncated payload is a miss, not corrupt data", async (t) => {
  const root = await temporaryRoot(t);
  const store = makeStore(root);
  await store.set("doc:one", 1, { lineCount: 4 }, new Uint8Array(8));
  const names = await entryNames(root);
  const payloadName = names.find((name) => name.endsWith(".bin"));
  assert.ok(payloadName);
  await fsp.writeFile(path.join(root, payloadName), new Uint8Array(3));

  assert.equal(await store.get("doc:one", 1), null);
  assert.deepEqual(await entryNames(root), []);
});

test("host disk cache: clear removes every entry and leaves a usable directory", async (t) => {
  const root = await temporaryRoot(t);
  const store = makeStore(root);
  await store.set("a", 1, {}, new Uint8Array([1]));
  await store.set("b", 1, {}, new Uint8Array([2]));
  await store.clear();

  assert.deepEqual(await entryNames(root), []);
  assert.equal(await store.set("c", 1, {}, new Uint8Array([3])), true);
  assert.ok(await store.get("c", 1));
});

test("host disk cache: keys with path separators are hashed into one flat filename", async (t) => {
  const root = await temporaryRoot(t);
  const store = makeStore(root);
  const key = "file:///a/b/c.jsonl";
  await store.set(key, 1, {}, new Uint8Array([1]));
  const names = await entryNames(root);
  assert.equal(names.filter((name) => name.endsWith(".bin")).length, 1);
  assert.ok(names.every((name) => !name.includes("/") && !name.includes("\\")));
  assert.ok(await store.get(key, 1));
});
