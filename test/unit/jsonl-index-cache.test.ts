import assert from "node:assert/strict";
import test from "node:test";
import { promises as fsp } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { FileFingerprint } from "@/common/fileFingerprint";
import { buildJsonlIndex } from "@/service/jsonlDocument";
import { JsonlIndexCache } from "@/service/jsonlIndexCache";

async function temporaryRoot(t: test.TestContext): Promise<string> {
  const root = await fsp.mkdtemp(path.join(tmpdir(), "jsonl-index-cache-"));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  return root;
}

const fingerprint: FileFingerprint = {
  key: "file:///data/events.jsonl",
  size: 4096,
  mtimeMs: 1_700_000_000_000,
};

test("jsonl index cache: offsets round-trip", async (t) => {
  const root = await temporaryRoot(t);
  const cache = new JsonlIndexCache(root);
  const index = buildJsonlIndex(new TextEncoder().encode('{"a":1}\n{"a":2}\n{"a":3}'));
  assert.equal(await cache.set(fingerprint, index), true);

  const restored = await cache.get(fingerprint);
  assert.deepEqual(restored, index);
});

test("jsonl index cache: an empty file round-trips", async (t) => {
  const root = await temporaryRoot(t);
  const cache = new JsonlIndexCache(root);
  const index = { offsets: [], lineCount: 0 };
  assert.equal(await cache.set(fingerprint, index), true);
  assert.deepEqual(await cache.get(fingerprint), index);
});

test("jsonl index cache: changed size or mtime is a miss and removes the entry", async (t) => {
  const root = await temporaryRoot(t);
  const cache = new JsonlIndexCache(root);
  const index = buildJsonlIndex(new TextEncoder().encode('{"a":1}\n{"a":2}'));
  await cache.set(fingerprint, index);

  assert.equal(await cache.get({ ...fingerprint, size: fingerprint.size + 1 }), null);
  assert.equal(await cache.get({ ...fingerprint, mtimeMs: fingerprint.mtimeMs + 1 }), null);
  assert.deepEqual(await fsp.readdir(root), []);
});

test("jsonl index cache: a corrupt payload is a miss and removes the entry", async (t) => {
  const root = await temporaryRoot(t);
  const cache = new JsonlIndexCache(root);
  await cache.set(fingerprint, buildJsonlIndex(new TextEncoder().encode('{"a":1}\n{"a":2}')));
  const names = await fsp.readdir(root);
  const payloadName = names.find((name) => name.endsWith(".bin"));
  assert.ok(payloadName);
  await fsp.writeFile(path.join(root, payloadName), new Uint8Array(4));

  assert.equal(await cache.get(fingerprint), null);
  assert.deepEqual(await fsp.readdir(root), []);
});

test("jsonl index cache: clear removes every document index", async (t) => {
  const root = await temporaryRoot(t);
  const cache = new JsonlIndexCache(root);
  await cache.set(fingerprint, buildJsonlIndex(new TextEncoder().encode('{"a":1}')));
  await cache.set(
    { ...fingerprint, key: "file:///other.jsonl" },
    buildJsonlIndex(new TextEncoder().encode('{"b":2}')),
  );
  await cache.clear();
  assert.deepEqual(await fsp.readdir(root), []);
});

test("jsonl file: a cached index skips the source scan", async () => {
  const text = '{"a":1}\n{"a":2}\n';
  const bytes = new TextEncoder().encode(text);
  let reads = 0;
  const source = {
    size: bytes.byteLength,
    async read(offset: number, length: number) {
      reads++;
      return bytes.subarray(offset, Math.min(bytes.byteLength, offset + length));
    },
  };
  const { JsonlFile } = await import("@/service/jsonlFile");
  const file = await JsonlFile.open(source, buildJsonlIndex(bytes));
  assert.equal(reads, 0);
  assert.equal(file.lineCount, 2);
});
