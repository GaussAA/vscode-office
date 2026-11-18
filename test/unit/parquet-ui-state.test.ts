import assert from "node:assert/strict";
import test from "node:test";
import { COLUMN_WIDTH_STORAGE_KEY } from "@/react/view/parquet/parquetLayout";
import {
  PARQUET_UI_PREFIX,
  clearParquetUiStorage,
  legacyColumnWidths,
  loadParquetUi,
  parseColumnWidths,
  saveParquetUi,
} from "@/react/view/parquet/parquetUiState";

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

const docKey = "file:///data.parquet";
const storageKey = PARQUET_UI_PREFIX + docKey;

function stored(key = docKey): Record<string, unknown> {
  const raw = storage.getItem(PARQUET_UI_PREFIX + key);
  assert.ok(raw, "the UI state entry is missing");
  return JSON.parse(raw) as Record<string, unknown>;
}

test("ui state: fields round-trip and merge independently", () => {
  storage.clear();
  saveParquetUi(docKey, { columnWidths: { id: 120 } });
  saveParquetUi(docKey, { row: 240 });
  saveParquetUi(docKey, { fieldFilter: "id" });

  assert.deepEqual(loadParquetUi(docKey), {
    columnWidths: { id: 120 },
    row: 240,
    fieldFilter: "id",
  });

  // The width map is a field: a new map replaces it and leaves the row/filter alone.
  saveParquetUi(docKey, { columnWidths: { tags: 180 } });
  assert.deepEqual(loadParquetUi(docKey), {
    columnWidths: { tags: 180 },
    row: 240,
    fieldFilter: "id",
  });
});

test("ui state: entries are per document and a missing key is a no-op", () => {
  storage.clear();
  saveParquetUi("file:///a.parquet", { row: 10 });
  saveParquetUi("file:///b.parquet", { row: 20 });
  assert.deepEqual(loadParquetUi("file:///a.parquet"), { row: 10 });
  assert.deepEqual(loadParquetUi("file:///b.parquet"), { row: 20 });

  saveParquetUi(undefined, { row: 30 });
  assert.equal(storage.length, 2);
  assert.equal(loadParquetUi(undefined), null);
});

test("ui state: an explicit empty width map beats the legacy fallback", () => {
  storage.clear();
  storage.setItem(COLUMN_WIDTH_STORAGE_KEY, JSON.stringify({ id: 140 }));
  assert.deepEqual(legacyColumnWidths(), { id: 140 });

  saveParquetUi(docKey, { columnWidths: {} });
  const state = loadParquetUi(docKey);
  assert.deepEqual(state, { columnWidths: {} });
  assert.notEqual(state?.columnWidths, undefined, "an empty map must not fall back");
});

test("ui state: expired, versioned and corrupt entries are removed", () => {
  storage.clear();
  saveParquetUi(docKey, { row: 1 });

  const old = stored();
  old.ts = Date.now() - 91 * 24 * 60 * 60 * 1000;
  storage.setItem(storageKey, JSON.stringify(old));
  assert.equal(loadParquetUi(docKey), null);
  assert.equal(storage.getItem(storageKey), null, "an expired entry is deleted");

  saveParquetUi(docKey, { row: 1 });
  const versioned = stored();
  versioned.v = 2;
  storage.setItem(storageKey, JSON.stringify(versioned));
  assert.equal(loadParquetUi(docKey), null);
  assert.equal(storage.getItem(storageKey), null, "a version mismatch is deleted");

  saveParquetUi(docKey, { row: 1 });
  storage.setItem(storageKey, "{ not json");
  assert.equal(loadParquetUi(docKey), null);
  assert.equal(storage.getItem(storageKey), null, "corrupt JSON is deleted");
});

test("ui state: stored widths/row/filter are validated before they reach layout", () => {
  storage.clear();
  // Bypass the writer to simulate a hand-edited or older blob with every field wrong.
  storage.setItem(
    storageKey,
    JSON.stringify({
      v: 1,
      ts: Date.now(),
      columnWidths: { a: 120, b: 50, c: 500, d: "wide", e: null },
      row: -4,
      fieldFilter: 7,
    }),
  );

  assert.deepEqual(loadParquetUi(docKey), { columnWidths: { a: 120 } });
  assert.deepEqual(parseColumnWidths('{"a":120,"b":63,"c":481,"d":"wide","e":null}'), {
    a: 120,
  });
  assert.deepEqual(parseColumnWidths("{"), {});
  assert.deepEqual(parseColumnWidths("null"), {});
});

test("ui state: clear removes only per-file UI entries", () => {
  storage.clear();
  saveParquetUi("file:///a.parquet", { row: 1 });
  saveParquetUi("file:///b.parquet", { row: 2 });
  storage.setItem(COLUMN_WIDTH_STORAGE_KEY, "{}");
  storage.setItem("parquet-shares:file:///a.parquet", "{}");

  clearParquetUiStorage();
  assert.equal(loadParquetUi("file:///a.parquet"), null);
  assert.equal(loadParquetUi("file:///b.parquet"), null);
  assert.equal(storage.getItem(COLUMN_WIDTH_STORAGE_KEY), "{}");
  assert.equal(storage.getItem("parquet-shares:file:///a.parquet"), "{}");
});
