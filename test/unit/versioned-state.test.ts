import assert from "node:assert/strict";
import test from "node:test";
import {
  clearPersistedPrefix,
  loadVersionedState,
  saveVersionedState,
} from "@/react/common/versionedState";

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

const storage = new MemoryStorage();
Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });

const PREFIX = "test-state:";
const DAY = 24 * 60 * 60 * 1000;

interface State {
  left: number;
  selected: number;
  mode: "tree" | "raw";
}

function parseState(value: unknown): State | null {
  if (!value || typeof value !== "object") return null;
  const parsed = value as Partial<State>;
  if (
    typeof parsed.left !== "number" ||
    typeof parsed.selected !== "number" ||
    (parsed.mode !== "tree" && parsed.mode !== "raw")
  ) {
    return null;
  }
  return { left: parsed.left, selected: parsed.selected, mode: parsed.mode };
}

function options(maxAgeMs = 90 * DAY) {
  return { version: 1, maxAgeMs, parse: parseState, parseLegacy: parseState };
}

function stored(key: string): Record<string, unknown> | null {
  const raw = storage.getItem(PREFIX + key);
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
}

test("versioned state: round-trips through a v/data record", () => {
  storage.clear();
  saveVersionedState(PREFIX, "doc", 1, { left: 320, selected: 7, mode: "raw" });
  assert.deepEqual(loadVersionedState(PREFIX, "doc", options()), {
    left: 320,
    selected: 7,
    mode: "raw",
  });
  assert.equal(stored("doc")?.v, 1);
});

test("versioned state: migrates a legacy entry in place", () => {
  storage.clear();
  storage.setItem(
    PREFIX + "doc",
    JSON.stringify({ left: 280, selected: 3, mode: "tree", ts: Date.now() }),
  );
  assert.deepEqual(loadVersionedState(PREFIX, "doc", options()), {
    left: 280,
    selected: 3,
    mode: "tree",
  });
  assert.equal(stored("doc")?.v, 1, "the legacy entry is rewritten in the new shape");
});

test("versioned state: drops an expired current entry", () => {
  storage.clear();
  storage.setItem(
    PREFIX + "doc",
    JSON.stringify({
      v: 1,
      data: { left: 320, selected: 1, mode: "tree" },
      ts: Date.now() - 91 * DAY,
    }),
  );
  assert.equal(loadVersionedState(PREFIX, "doc", options()), null);
  assert.equal(storage.getItem(PREFIX + "doc"), null);
});

test("versioned state: drops an expired legacy entry", () => {
  storage.clear();
  storage.setItem(
    PREFIX + "doc",
    JSON.stringify({ left: 320, selected: 1, mode: "tree", ts: Date.now() - 91 * DAY }),
  );
  assert.equal(loadVersionedState(PREFIX, "doc", options()), null);
  assert.equal(storage.getItem(PREFIX + "doc"), null);
});

test("versioned state: a future version is not mistaken for legacy", () => {
  storage.clear();
  storage.setItem(
    PREFIX + "doc",
    JSON.stringify({ v: 99, data: { left: 320, selected: 1, mode: "tree" }, ts: Date.now() }),
  );
  assert.equal(loadVersionedState(PREFIX, "doc", options()), null);
  assert.equal(storage.getItem(PREFIX + "doc"), null);
});

test("versioned state: corrupt JSON and invalid shapes are removed", () => {
  storage.clear();
  storage.setItem(PREFIX + "corrupt", "{not json");
  storage.setItem(PREFIX + "bad", JSON.stringify({ v: 1, data: { left: "x" } }));
  assert.equal(loadVersionedState(PREFIX, "corrupt", options()), null);
  assert.equal(loadVersionedState(PREFIX, "bad", options()), null);
  assert.equal(storage.getItem(PREFIX + "corrupt"), null);
  assert.equal(storage.getItem(PREFIX + "bad"), null);
});

test("versioned state: clear removes only entries under the prefix", () => {
  storage.clear();
  saveVersionedState(PREFIX, "a", 1, { left: 200, selected: 0, mode: "tree" });
  saveVersionedState("other:", "b", 1, { left: 200, selected: 0, mode: "tree" });
  clearPersistedPrefix(PREFIX);
  assert.equal(storage.getItem(PREFIX + "a"), null);
  assert.ok(storage.getItem("other:b"));
});
