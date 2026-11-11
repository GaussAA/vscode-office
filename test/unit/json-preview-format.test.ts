import assert from "node:assert/strict";
import test from "node:test";
import { collectMatchPaths, firstMatchKey } from "@/react/view/json/jsonPreviewFormat";
import { readCopyPath, readSelection } from "@/react/view/jsonl/jsonlSelection";
import type { JsonlEntryDetail } from "@/common/jsonlTypes";

test("firstMatchKey: key, string value, nested object and array", () => {
  assert.equal(firstMatchKey({ alpha: 1 }, "alpha"), '["alpha"]');
  assert.equal(firstMatchKey({ user: { name: "Ada" } }, "ada"), '["user","name"]');
  assert.equal(
    firstMatchKey({ rows: [{ id: "x" }, { id: "target" }] }, "target"),
    '["rows",1,"id"]',
  );
  assert.equal(firstMatchKey({ n: 42 }, "42"), '["n"]');
  assert.equal(firstMatchKey({ ok: true }, "true"), '["ok"]');
});

test("firstMatchKey: case-insensitive, empty and composite previews are not text", () => {
  assert.equal(firstMatchKey({ Name: "ALPHA" }, "alpha"), '["Name"]');
  assert.equal(firstMatchKey({ Name: "ALPHA" }, "  "), null);
  assert.equal(firstMatchKey({ Name: "ALPHA" }, "missing"), null);
  assert.equal(firstMatchKey({ nested: { a: 1 } }, "{"), null);
});

test("firstMatchKey: root scalars have no tree row", () => {
  assert.equal(firstMatchKey("alpha", "alpha"), null);
  assert.equal(firstMatchKey(1, "1"), null);
});

test("collectMatchPaths: path + snippet rows in traversal order, capped", () => {
  const value = {
    service: "demo",
    endpoints: [
      { path: "/a", method: "GET" },
      { path: "/b", method: "POST" },
    ],
    note: "GET is used",
  };
  const results = collectMatchPaths(value, "get");
  assert.equal(results.length, 2);
  assert.equal(results[0].path, "endpoints[0].method");
  assert.equal(results[0].snippet, "GET");
  assert.equal(results[1].path, "note");
  assert.equal(collectMatchPaths(value, "get", 1).length, 1);
  assert.deepEqual(collectMatchPaths(value, ""), []);
});

test("readSelection/readCopyPath: JSON record labels replace L<n> without touching JSONL", () => {
  const entry: JsonlEntryDetail = {
    index: 7,
    kind: "value",
    value: "scalar",
    text: '"scalar"',
    textChars: 8,
    textTruncated: false,
    raw: '"scalar"',
    size: 8,
  };
  const selection = readSelection(entry, null, 7, "[7]");
  assert.equal(selection?.panelPath, "[7]");
  assert.equal(readCopyPath(entry, null, 7, "[7]"), "[7]");
  assert.equal(readSelection(entry, null, 7)?.panelPath, "L8");
  assert.equal(readCopyPath(entry, null, 7), "L8");
});
