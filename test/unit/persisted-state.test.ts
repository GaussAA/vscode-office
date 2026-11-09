import assert from "node:assert/strict";
import test from "node:test";
import { PERSIST_MAX_ENTRIES, savePersistedState } from "@/react/common/persistedState";

/** Minimal localStorage stand-in; Node has no web storage in the unit-test process. */
class MemoryStorage implements Storage {
  private data = new Map<string, string>();

  get length() {
    return this.data.size;
  }

  clear() {
    this.data.clear();
  }

  getItem(key: string) {
    return this.data.get(key) ?? null;
  }

  key(index: number) {
    return [...this.data.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.data.delete(key);
  }

  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
}

function withStorage(run: (storage: MemoryStorage) => void) {
  const storage = new MemoryStorage();
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: storage,
  });
  try {
    run(storage);
  } finally {
    if (originalStorage) {
      Object.defineProperty(globalThis, "localStorage", originalStorage);
    } else {
      delete (globalThis as { localStorage?: Storage }).localStorage;
    }
  }
}

test("savePersistedState keeps only the newest entries under its prefix", () => {
  const originalNow = Date.now;
  let now = 1_000_000;
  Date.now = () => now++;

  try {
    withStorage((storage) => {
      for (let index = 0; index < PERSIST_MAX_ENTRIES + 5; index++) {
        savePersistedState("test-state:", `doc-${index}`, { page: index });
      }

      const keys: string[] = [];
      for (let index = 0; index < storage.length; index++) {
        const key = storage.key(index);
        if (key) keys.push(key);
      }

      assert.equal(keys.length, PERSIST_MAX_ENTRIES);
      assert.equal(storage.getItem("test-state:doc-0"), null);
      assert.equal(storage.getItem("test-state:doc-4"), null);
      assert.ok(storage.getItem(`test-state:doc-${PERSIST_MAX_ENTRIES + 4}`));
    });
  } finally {
    Date.now = originalNow;
  }
});

test("savePersistedState leaves unrelated storage keys alone", () => {
  withStorage((storage) => {
    storage.setItem("other-state:doc", JSON.stringify({ ts: 1 }));
    savePersistedState("test-state:", "doc", { page: 1 });

    assert.ok(storage.getItem("other-state:doc"));
    assert.ok(storage.getItem("test-state:doc"));
  });
});
