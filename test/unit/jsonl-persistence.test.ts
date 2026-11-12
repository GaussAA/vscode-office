import { test } from "node:test";
import assert from "node:assert/strict";
import { parseJsonlPersistedState } from "../../src/react/view/jsonl/jsonlPersistence";

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
