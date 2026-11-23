import assert from "node:assert/strict";
import test from "node:test";
import { clearParquetLocalCaches } from "@/react/view/parquet/parquetCacheStorage";

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

test("clear cache: removes every parquet-derived key and leaves other viewers alone", () => {
  storage.clear();
  const parquet = [
    "parquet-shares:file:///a.parquet",
    "parquet-ui:file:///a.parquet",
    "parquet-state:/a.parquet",
    "parquet-column-widths",
    "parquet-sider-width",
  ];
  const others = [
    "jsonl-state:file:///a.jsonl",
    "json-preview:left:file:///a.json",
    "other-view:file:///a.bin",
    "unrelated",
  ];
  for (const key of [...parquet, ...others]) storage.setItem(key, "{}");

  clearParquetLocalCaches();

  for (const key of parquet) assert.equal(storage.getItem(key), null, `${key} survived`);
  for (const key of others) assert.equal(storage.getItem(key), "{}", `${key} was removed`);
});

test("clear cache: is a no-op when the parquet keys are already gone", () => {
  storage.clear();
  storage.setItem("jsonl-state:keep", "{}");
  clearParquetLocalCaches();
  assert.equal(storage.getItem("jsonl-state:keep"), "{}");
});
