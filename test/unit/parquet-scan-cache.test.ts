import assert from "node:assert/strict";
import test from "node:test";
import type { ParquetColumnScan } from "@/common/parquetProfileTypes";
import { ParquetScanCache, type ParquetScanFingerprint } from "@/service/parquetScanCache";

function scan(name: string): ParquetColumnScan {
  return {
    name,
    scanned: 10,
    rowCount: 10,
    complete: true,
    distinct: 1,
    nulls: 0,
    empties: 0,
    emptyRatio: 0,
    top: [{ value: "a", count: 10 }],
  };
}

const fp = {
  key: "file:///a.parquet",
  size: 100,
  mtimeMs: 1,
} satisfies ParquetScanFingerprint;

test("scan cache: a hit returns the stored scan and does not run again", async () => {
  const cache = new ParquetScanCache();
  let runs = 0;
  const first = await cache.scan(fp, "name", async () => {
    runs += 1;
    return scan("name");
  });
  const second = await cache.scan(fp, "name", async () => {
    runs += 1;
    return scan("name");
  });

  assert.equal(runs, 1);
  assert.equal(second, first);
  assert.equal(cache.get(fp, "name"), first);
});

test("scan cache: size or mtime invalidates, and the old version is dropped", async () => {
  const cache = new ParquetScanCache();
  await cache.scan(fp, "name", async () => scan("name"));
  assert.equal(cache.fileCount, 1);

  const newer = { ...fp, mtimeMs: fp.mtimeMs + 1 };
  await cache.scan(newer, "name", async () => scan("name"));
  assert.equal(cache.get(fp, "name"), undefined, "the old fingerprint must miss");
  assert.ok(cache.get(newer, "name"));
  assert.equal(cache.fileCount, 1, "a changed file replaced its old entry");

  const resized = { ...newer, size: (newer.size ?? 0) + 1 };
  await cache.scan(resized, "name", async () => scan("name"));
  assert.equal(cache.get(newer, "name"), undefined);
  assert.ok(cache.get(resized, "name"));
});

test("scan cache: keeps the most recently used three files", async () => {
  const cache = new ParquetScanCache(2);
  const a = { ...fp, key: "file:///a.parquet" };
  const b = { ...fp, key: "file:///b.parquet" };
  const c = { ...fp, key: "file:///c.parquet" };
  await cache.scan(a, "name", async () => scan("name"));
  await cache.scan(b, "name", async () => scan("name"));

  // Touching A makes B the least recently used.
  assert.ok(cache.get(a, "name"));
  await cache.scan(c, "name", async () => scan("name"));

  assert.equal(cache.get(b, "name"), undefined, "B should have been evicted");
  assert.ok(cache.get(a, "name"));
  assert.ok(cache.get(c, "name"));
  assert.equal(cache.fileCount, 2);
});

test("scan cache: two concurrent requests for one column share one run", async () => {
  const cache = new ParquetScanCache();
  let runs = 0;
  let release!: (result: ParquetColumnScan) => void;
  const gate = new Promise<ParquetColumnScan>((resolve) => {
    release = resolve;
  });
  const run = () => {
    runs += 1;
    return gate;
  };

  const first = cache.scan(fp, "name", run);
  const second = cache.scan(fp, "name", run);
  assert.equal(runs, 1, "the second request joined the in-flight scan");

  release(scan("name"));
  const [left, right] = await Promise.all([first, second]);
  assert.equal(left, right);
  assert.equal(cache.get(fp, "name"), left);
});

test("scan cache: a failed run is not cached and the next request retries", async () => {
  const cache = new ParquetScanCache();
  await assert.rejects(
    cache.scan(fp, "name", async () => {
      throw new Error("boom");
    }),
    /boom/,
  );
  assert.equal(cache.get(fp, "name"), undefined);

  let runs = 0;
  const recovered = await cache.scan(fp, "name", async () => {
    runs += 1;
    return scan("name");
  });
  assert.equal(runs, 1);
  assert.equal(cache.get(fp, "name"), recovered);
});

test("scan cache: clear drops everything and a scan already in flight cannot land", async () => {
  const cache = new ParquetScanCache();
  await cache.scan(fp, "name", async () => scan("name"));
  cache.clear();
  assert.equal(cache.get(fp, "name"), undefined);
  assert.equal(cache.fileCount, 0);

  let release!: (result: ParquetColumnScan) => void;
  const gate = new Promise<ParquetColumnScan>((resolve) => {
    release = resolve;
  });
  const pending = cache.scan(fp, "score", () => gate);
  cache.clear();
  release(scan("score"));
  await pending;
  assert.equal(cache.get(fp, "score"), undefined, "a pre-clear scan must not repopulate");
});
