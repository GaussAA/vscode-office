import assert from "node:assert/strict";
import test from "node:test";
import type { JsonlEntryDetail } from "@/common/jsonlTypes";
import { MAX_TEXT_CHARS, SUMMARY_CHARS, VALUE_PANEL_MAX_CHARS } from "@/common/recordConstants";
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
  textIncluded: false,
};

function valueEntry(value: unknown, index = 0): JsonlEntryDetail {
  return { ...base, index, kind: "value", value, textIncluded: true };
}

function errorEntry(kind: "invalid" | "too-large", text: string): JsonlEntryDetail {
  const base = {
    index: 0,
    size: text.length,
    raw: "",
    text,
    textChars: text.length,
    textTruncated: false,
    textIncluded: true,
  };
  return kind === "invalid"
    ? { ...base, kind: "invalid", error: "Unexpected end of JSON input" }
    : { ...base, kind: "too-large" };
}

test("selection: a scalar root is selected without a tree row", () => {
  const entry = valueEntry("hello", 4);
  const selection = readSelection(entry, null, 4);
  assert.ok(selection);
  assert.equal(selection.value, "hello");
  assert.equal(selection.panelPath, "L5");
  assert.equal(selection.preview, "hello");
  assert.equal(selection.typeLabel, "string");
  assert.equal(selection.source, "value");
  assert.equal(collapsedChars(selection), 5);
  assert.equal(readActiveValue(entry, null), "hello");
});

test("selection: a composite root points the bar at the whole record (ADR-0030)", () => {
  const root = { user: { name: "alpha" }, tags: ["a", "b"] };
  const entry = valueEntry(root);
  const selection = readSelection(entry, null, 0);
  assert.ok(selection, "the root fallback replaced the old null");
  assert.equal(selection.panelPath, "L1");
  assert.equal(selection.preview, "{…}");
  assert.equal(selection.typeLabel, "object{2}");
  assert.deepEqual(selection.value, root);
  assert.equal(readCopyPath(entry, null, 0), "L1");
});

test("selection: an active key still narrows the bar to that value", () => {
  const entry = valueEntry({ user: { name: "alpha" } });
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

  const composite = readSelection(entry, makePathKey(["user"]), 2);
  assert.ok(composite);
  assert.equal(composite.preview, "{…}");
  assert.equal(composite.typeLabel, "object{1}");
  assert.equal(collapsedChars(composite), null);
});

test(`selection: previews keep the first line and cap at ${SUMMARY_CHARS} characters`, () => {
  const long = `${"x".repeat(200)}\nsecond line`;
  const selection = readSelection(valueEntry(long), null, 0);
  assert.ok(selection);
  assert.equal(selection.preview, `${"x".repeat(SUMMARY_CHARS)}…`);

  const spaced = readSelection(valueEntry("   hello\nworld  "), null, 0);
  assert.ok(spaced);
  assert.equal(spaced.preview, "hello");
});

test("selection: error lines read their raw text through the same panel", () => {
  const invalid = errorEntry("invalid", '{"id":3, broken');
  const tooLarge = errorEntry("too-large", "z".repeat(500));
  for (const entry of [invalid, tooLarge]) {
    const selection = readSelection(entry, null, 0);
    assert.ok(selection, `${entry.kind} got no selection`);
    assert.equal(selection.source, "text");
    assert.equal(selection.panelPath, "L1");
    assert.equal(readActiveValue(entry, null), entry.text);
    const panel = readPanel(selection);
    assert.equal(panel.text, entry.text);
    assert.equal(panel.chars, entry.text.length);
  }
  // The empty kind has no content and therefore no bar.
  assert.equal(readSelection({ ...base, kind: "empty" }, null, 0), null);
});

test("selection: the panel budget depends on the source", () => {
  const hugeValue = "x".repeat(VALUE_PANEL_MAX_CHARS + 10);
  const valuePanel = readPanel(readSelection(valueEntry(hugeValue), null, 0)!);
  assert.equal(valuePanel.text.length, VALUE_PANEL_MAX_CHARS);
  assert.equal(valuePanel.chars, VALUE_PANEL_MAX_CHARS + 10);
  assert.equal(valuePanel.truncated, true);

  const hugeText = "y".repeat(MAX_TEXT_CHARS);
  const textPanel = readPanel(readSelection(errorEntry("too-large", hugeText), null, 0)!);
  assert.equal(textPanel.text.length, MAX_TEXT_CHARS);
  assert.equal(textPanel.chars, MAX_TEXT_CHARS);
  assert.equal(textPanel.truncated, false);
});
