import assert from "node:assert/strict";
import test from "node:test";
import { JSONL_VALUE_TEXT_LIMIT, type JsonlEntryDetail } from "@/common/jsonlTypes";
import { makePathKey } from "@/react/view/entry/entryFormat";
import {
  collapsedChars,
  readActiveValue,
  readCopyPath,
  readPanel,
  readSelection,
} from "@/react/view/entry/entrySelection";

const base = {
  index: 0,
  size: 100,
  raw: "",
  text: "",
  textChars: 0,
  textTruncated: false,
};

function valueEntry(value: unknown, index = 0): JsonlEntryDetail {
  return { ...base, index, kind: "value", value };
}

test("selection: a scalar root is selected without a tree row", () => {
  const entry = valueEntry("hello", 4);
  const selection = readSelection(entry, null, 4);
  assert.ok(selection);
  assert.equal(selection.value, "hello");
  assert.equal(selection.panelPath, "L5");
  assert.equal(selection.preview, "hello");
  assert.equal(selection.typeLabel, "string");
  assert.equal(collapsedChars(selection), 5);
  assert.equal(readActiveValue(entry, null), "hello");
});

test("selection: a composite root waits for an active row", () => {
  const entry = valueEntry({ user: { name: "alpha" }, tags: ["a", "b"] });
  assert.equal(readSelection(entry, null, 0), null);
  // Copy value still targets the whole entry when no row is selected.
  assert.deepEqual(readActiveValue(entry, null), { user: { name: "alpha" }, tags: ["a", "b"] });
  assert.equal(readCopyPath(entry, null, 0), "L1");

  const key = makePathKey(["user", "name"]);
  const selection = readSelection(entry, key, 0);
  assert.ok(selection);
  assert.equal(selection.value, "alpha");
  assert.equal(selection.panelPath, "user.name");
  assert.equal(selection.preview, "alpha");
  assert.equal(selection.typeLabel, "string");
  assert.equal(collapsedChars(selection), 5);
  assert.equal(readActiveValue(entry, key), "alpha");
  assert.equal(readCopyPath(entry, key, 0), "L1 › user.name");
});

test("selection: an active composite previews as a collapsed object", () => {
  const entry = valueEntry({ user: { name: "alpha" } });
  const key = makePathKey(["user"]);
  const selection = readSelection(entry, key, 2);
  assert.ok(selection);
  assert.equal(selection.preview, "{…}");
  assert.equal(selection.typeLabel, "object{1}");
  assert.equal(collapsedChars(selection), null);
});

test("selection: previews keep the first line and cap at 160 characters", () => {
  const long = `${"x".repeat(200)}\nsecond line`;
  const entry = valueEntry(long);
  const selection = readSelection(entry, null, 0);
  assert.ok(selection);
  assert.equal(selection.preview, `${"x".repeat(160)}…`);

  const spaced = valueEntry("   hello\nworld  ");
  const spacedSelection = readSelection(spaced, null, 0);
  assert.ok(spacedSelection);
  assert.equal(spacedSelection.preview, "hello");
});

test("selection: non-value entries have no selection and no copy target", () => {
  const invalid: JsonlEntryDetail = {
    ...base,
    kind: "invalid",
    error: "Unexpected end of JSON input",
  };
  const tooLarge: JsonlEntryDetail = { ...base, kind: "too-large" };
  assert.equal(readSelection(invalid, null, 0), null);
  assert.equal(readSelection(tooLarge, null, 0), null);
  assert.equal(readActiveValue(invalid, null), undefined);
  assert.equal(readActiveValue(tooLarge, null), undefined);
});

test("selection: the panel text is capped and reports the whole length", () => {
  const whole = "x".repeat(1_000_001);
  const selection = readSelection(valueEntry(whole), null, 0);
  assert.ok(selection);
  const panel = readPanel(selection);
  assert.equal(panel.text.length, JSONL_VALUE_TEXT_LIMIT);
  assert.equal(panel.chars, 1_000_001);
  assert.equal(panel.truncated, true);
});
