import assert from "node:assert/strict";
import test from "node:test";
import {
  clearJsonlPersisted,
  loadJsonlPersisted,
  parseJsonlPersistedState,
  saveJsonlPersisted,
} from "@/react/view/jsonl/jsonlPersistence";

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

const PREFIX = "jsonl-state:";
const DAY = 24 * 60 * 60 * 1000;

test("jsonl state: round-trips and writes the versioned record", () => {
  storage.clear();
  saveJsonlPersisted("doc", { left: 300, selected: 4, mode: "raw" });
  assert.deepEqual(loadJsonlPersisted("doc"), { left: 300, selected: 4, mode: "raw" });
  const stored = JSON.parse(storage.getItem(PREFIX + "doc") ?? "{}") as { v?: number };
  assert.equal(stored.v, 1);
});

test("jsonl state: migrates a legacy entry", () => {
  storage.clear();
  storage.setItem(
    PREFIX + "doc",
    JSON.stringify({ left: 280, selected: 2, mode: "tree", ts: Date.now() }),
  );
  assert.deepEqual(loadJsonlPersisted("doc"), { left: 280, selected: 2, mode: "tree" });
  const stored = JSON.parse(storage.getItem(PREFIX + "doc") ?? "{}") as { v?: number };
  assert.equal(stored.v, 1);
});

test("jsonl state: expires after 90 days", () => {
  storage.clear();
  storage.setItem(
    PREFIX + "doc",
    JSON.stringify({ left: 300, selected: 3, mode: "tree", ts: Date.now() - 91 * DAY }),
  );
  assert.equal(loadJsonlPersisted("doc"), null);
  assert.equal(storage.getItem(PREFIX + "doc"), null);
});

test("jsonl persisted state: valid fields survive", () => {
  assert.deepEqual(parseJsonlPersistedState('{"left":400,"selected":12,"mode":"raw"}'), {
    left: 400,
    selected: 12,
    mode: "raw",
  });
});

test("jsonl persisted state: malformed JSON is ignored", () => {
  assert.equal(parseJsonlPersistedState("{"), null);
  assert.equal(parseJsonlPersistedState("null"), null);
});

test("jsonl persisted state: bad fields fall back instead of reaching the splitter", () => {
  assert.deepEqual(parseJsonlPersistedState('{"left":9999,"selected":-4,"mode":"weird"}'), {
    left: 720,
    selected: 0,
    mode: "tree",
  });
  assert.deepEqual(parseJsonlPersistedState('{"left":"wide","selected":2.8}'), {
    left: 340,
    selected: 2,
    mode: "tree",
  });
});

test("jsonl state: parse clamps the persisted values", () => {
  assert.deepEqual(parseJsonlPersistedState('{"left":-100,"selected":-2}'), {
    left: 240,
    selected: 0,
    mode: "tree",
  });
  assert.equal(parseJsonlPersistedState("not json"), null);
});

test("jsonl state: clear removes every document entry only", () => {
  storage.clear();
  saveJsonlPersisted("a", { left: 300, selected: 1, mode: "tree" });
  saveJsonlPersisted("b", { left: 300, selected: 2, mode: "tree" });
  storage.setItem("excel-view:doc", "{}");
  clearJsonlPersisted();
  assert.equal(storage.getItem(PREFIX + "a"), null);
  assert.equal(storage.getItem(PREFIX + "b"), null);
  assert.ok(storage.getItem("excel-view:doc"));
});
