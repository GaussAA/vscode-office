import assert from "node:assert/strict";
import test from "node:test";
import type { ParquetEmptyShare } from "@/common/parquetProfileTypes";
import {
  loadParquetShares,
  saveParquetShares,
  type ParquetShareScope,
} from "@/react/view/parquet/parquetShareCache";

/** The cache module touches `localStorage` at call time; the test supplies a small one. */
class MemoryStorage {
  private values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, String(value));
  }
}

const storage = new MemoryStorage();
Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });

const scope = {
  key: "file:///data.parquet",
  size: 1024,
  mtimeMs: 1_700_000_000_000,
} satisfies ParquetShareScope;
const storageKey = "parquet-shares:" + scope.key;
const share: ParquetEmptyShare = {
  name: "tags",
  scanned: 6,
  rowCount: 6,
  complete: true,
  nulls: 2,
  empties: 2,
  emptyRatio: 4 / 6,
};

function stored(): Record<string, unknown> {
  const raw = storage.getItem(storageKey);
  assert.ok(raw, "the cache entry is missing");
  return JSON.parse(raw) as Record<string, unknown>;
}

test("share cache: the same fingerprint loads; a changed mtime drops the entry", () => {
  storage.clear();
  saveParquetShares(scope, [share]);

  assert.deepEqual(loadParquetShares(scope), [share]);

  assert.deepEqual(loadParquetShares({ ...scope, mtimeMs: scope.mtimeMs + 1 }), []);
  assert.equal(storage.getItem(storageKey), null, "the stale entry was left in storage");
});

test("share cache: a changed size, a new version and a corrupt blob all miss", () => {
  storage.clear();
  saveParquetShares(scope, [share]);

  assert.deepEqual(loadParquetShares({ ...scope, size: scope.size + 1 }), []);
  assert.equal(storage.getItem(storageKey), null, "the size-mismatched entry was left behind");

  saveParquetShares(scope, [share]);
  storage.setItem(storageKey, JSON.stringify({ ...stored(), v: 0 }));
  assert.deepEqual(loadParquetShares(scope), [], "a different algorithm version was accepted");

  saveParquetShares(scope, [share]);
  storage.setItem(storageKey, "{ not json");
  assert.deepEqual(loadParquetShares(scope), [], "a corrupt blob was accepted");
  assert.equal(storage.getItem(storageKey), null, "the corrupt blob was left in storage");
});

test("share cache: sequential writes merge columns instead of replacing the table", () => {
  storage.clear();
  const meta: ParquetEmptyShare = {
    ...share,
    name: "meta",
    nulls: 2,
    empties: 0,
    emptyRatio: 2 / 6,
  };
  saveParquetShares(scope, [share]);
  saveParquetShares(scope, [meta]);

  const loaded = new Map(loadParquetShares(scope).map((entry) => [entry.name, entry]));
  assert.deepEqual(loaded.get("tags"), share);
  assert.deepEqual(loaded.get("meta"), meta);

  // A later scan of the same column wins for that column only.
  const updated = { ...share, nulls: 0, empties: 6, emptyRatio: 1 };
  saveParquetShares(scope, [updated]);
  const after = new Map(loadParquetShares(scope).map((entry) => [entry.name, entry]));
  assert.deepEqual(after.get("tags"), updated);
  assert.deepEqual(after.get("meta"), meta);
});

test("share cache: a different fingerprint replaces instead of merging", () => {
  storage.clear();
  saveParquetShares(scope, [share]);
  const newer = { ...scope, mtimeMs: scope.mtimeMs + 1 };
  const meta: ParquetEmptyShare = {
    ...share,
    name: "meta",
    nulls: 0,
    empties: 0,
    emptyRatio: 0,
  };
  saveParquetShares(newer, [meta]);

  assert.deepEqual(loadParquetShares(newer), [meta]);
  assert.deepEqual(loadParquetShares(scope), [], "the old fingerprint's entry was kept");
});

test("share cache: a corrupt current entry does not block a fresh write", () => {
  storage.clear();
  saveParquetShares(scope, [share]);
  storage.setItem(storageKey, "{ not json");
  saveParquetShares(scope, [share]);

  assert.deepEqual(loadParquetShares(scope), [share]);
});

test("share cache: an entry older than a week is ignored", () => {
  storage.clear();
  saveParquetShares(scope, [share]);
  storage.setItem(
    storageKey,
    JSON.stringify({ ...stored(), ts: Date.now() - 8 * 24 * 60 * 60 * 1000 }),
  );

  assert.deepEqual(loadParquetShares(scope), []);
  assert.equal(storage.getItem(storageKey), null, "the expired entry was left in storage");
});

test("share cache: a share with a broken shape is rejected, and no mtime means no cache", () => {
  storage.clear();
  saveParquetShares(scope, [share]);
  storage.setItem(
    storageKey,
    JSON.stringify({ ...stored(), shares: [{ ...share, emptyRatio: "x" }] }),
  );
  assert.deepEqual(loadParquetShares(scope), []);

  storage.clear();
  saveParquetShares({ key: scope.key, size: scope.size }, [share]);
  assert.equal(storage.getItem(storageKey), null, "a document without a mtime was cached");
  assert.deepEqual(loadParquetShares({ key: scope.key, size: scope.size }), []);
});
