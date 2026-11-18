import assert from "node:assert/strict";
import test from "node:test";
import { promises as fsp } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  JSON_PREVIEW_RANGE_VERSION,
  JsonPreviewRangeCache,
  jsonPreviewRangeKey,
} from "@/service/jsonPreviewRangeCache";

async function temporaryRoot(t: test.TestContext): Promise<string> {
  const root = await fsp.mkdtemp(path.join(tmpdir(), "json-range-cache-"));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  return root;
}

const fingerprint = { key: "file:///data/a.json", size: 100, mtimeMs: 42 };

test("json range cache: ranges round-trip and key carries the version", async (t) => {
  const root = await temporaryRoot(t);
  const cache = new JsonPreviewRangeCache(root);
  const ranges = [
    { start: 1, end: 10 },
    { start: 12, end: 40 },
  ];
  assert.equal(await cache.set(fingerprint, ranges), true);
  assert.deepEqual(await cache.get(fingerprint), ranges);
  assert.match(jsonPreviewRangeKey(fingerprint), new RegExp(`:${JSON_PREVIEW_RANGE_VERSION}$`));
});

test("json range cache: changed size or mtime misses and removes the entry", async (t) => {
  const root = await temporaryRoot(t);
  const cache = new JsonPreviewRangeCache(root);
  await cache.set(fingerprint, [{ start: 1, end: 10 }]);
  assert.equal(await cache.get({ ...fingerprint, size: 101 }), null);
  assert.equal(await cache.get({ ...fingerprint, mtimeMs: 43 }), null);
  assert.deepEqual(await fsp.readdir(root), []);
});

test("json range cache: a truncated payload is a miss and removes the entry", async (t) => {
  const root = await temporaryRoot(t);
  const cache = new JsonPreviewRangeCache(root);
  await cache.set(fingerprint, [
    { start: 1, end: 10 },
    { start: 12, end: 40 },
  ]);
  const payloadName = (await fsp.readdir(root)).find((name) => name.endsWith(".bin"));
  assert.ok(payloadName);
  await fsp.writeFile(path.join(root, payloadName), new Uint8Array(8));
  assert.equal(await cache.get(fingerprint), null);
  assert.deepEqual(await fsp.readdir(root), []);
});

test("json range cache: unordered or overlapping ranges are rejected", async (t) => {
  const root = await temporaryRoot(t);
  const cache = new JsonPreviewRangeCache(root);
  assert.equal(
    await cache.set(fingerprint, [
      { start: 12, end: 20 },
      { start: 5, end: 10 },
    ]),
    false,
  );
  assert.equal(
    await cache.set(fingerprint, [
      { start: 1, end: 20 },
      { start: 10, end: 30 },
    ]),
    false,
  );
  assert.equal(await cache.set(fingerprint, [{ start: 5, end: 5 }]), false);
});

test("json range cache: clear removes every entry", async (t) => {
  const root = await temporaryRoot(t);
  const cache = new JsonPreviewRangeCache(root);
  await cache.set(fingerprint, [{ start: 1, end: 10 }]);
  await cache.clear();
  assert.deepEqual(await fsp.readdir(root), []);
});
