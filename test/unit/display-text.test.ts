import assert from "node:assert/strict";
import test from "node:test";
import { toDisplayText } from "@/common/displayText";

/**
 * `toDisplayText` replaced nine `String(value)` calls that `oxlint --type-aware`
 * (`typescript/no-base-to-string`) flagged: on a value typed `unknown`, `String()` renders
 * objects as `[object Object]`. These cases pin the part that was silently wrong.
 */

test("displayText: primitives render as themselves", () => {
  assert.equal(toDisplayText("text"), "text");
  assert.equal(toDisplayText(42), "42");
  assert.equal(toDisplayText(-0.5), "-0.5");
  assert.equal(toDisplayText(true), "true");
  assert.equal(toDisplayText(10n), "10");
});

test("displayText: null and undefined become an empty cell", () => {
  assert.equal(toDisplayText(null), "");
  assert.equal(toDisplayText(undefined), "");
});

test("displayText: objects keep their content instead of [object Object]", () => {
  assert.equal(toDisplayText({ a: 1 }), '{"a":1}');
  assert.equal(toDisplayText([1, 2]), "[1,2]");
  assert.ok(!toDisplayText({ a: 1 }).includes("[object Object]"));
});

test("displayText: dates use ISO, not the locale default", () => {
  assert.equal(toDisplayText(new Date("2026-01-02T03:04:05.000Z")), "2026-01-02T03:04:05.000Z");
});

test("displayText: a cyclic object does not throw", () => {
  const cyclic = { name: "loop" };
  cyclic.self = cyclic;
  assert.equal(toDisplayText(cyclic), "[object]");
});
