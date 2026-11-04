// Tests live in a subfolder, so they are private — but they still cross the
// same seam as every caller: the package's ENTRY POINT. Never import `../lib/…`.
import assert from "node:assert/strict";
import { test } from "node:test";

import { summarizeTable } from "../index.ts";

test("summarizeTable reports a null count per column", () => {
  const rows = [
    { id: 1, name: "alpha" },
    { id: 2, name: null },
  ];

  assert.deepEqual(summarizeTable(rows), [
    { column: "id", nullCount: 0 },
    { column: "name", nullCount: 1 },
  ]);
});
