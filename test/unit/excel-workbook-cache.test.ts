import assert from "node:assert/strict";
import test from "node:test";
import {
  EXCEL_WORKBOOK_CACHE_ENTRIES,
  EXCEL_WORKBOOK_CACHE_VERSION,
  ExcelWorkbookCache,
  excelWorkbookCacheKey,
  workbookSheetMeta,
} from "@/service/excelWorkbookCache";
import type { WorkbookSheetRows } from "@/common/workbookRows";

function sheets(name = "Data", rows = 4): WorkbookSheetRows[] {
  return [
    {
      name,
      rows: Array.from({ length: rows }, (_, row) => [`r${row}`, "x"]),
    },
  ];
}

test("excel workbook cache: key carries document, size, mtime and version", () => {
  assert.equal(
    excelWorkbookCacheKey({ key: "file:a", size: 10, mtimeMs: 20 }),
    `file:a:10:20:${EXCEL_WORKBOOK_CACHE_VERSION}`,
  );
});

test("excel workbook cache: sheet metadata counts rows and the widest row", () => {
  assert.deepEqual(
    workbookSheetMeta([
      { name: "Data", rows: [["a"], ["b", "c", "d"]] },
      { name: "Empty", rows: [] },
    ]),
    [
      { name: "Data", rowCount: 2, columnCount: 3 },
      { name: "Empty", rowCount: 0, columnCount: 1 },
    ],
  );
});

test("excel workbook cache: get refreshes LRU and evicts the oldest file", () => {
  const cache = new ExcelWorkbookCache();
  const a = sheets("a");
  const b = sheets("b");
  const c = sheets("c");
  cache.set("a", a);
  cache.set("b", b);
  assert.equal(cache.get("a"), a, "get refreshes a");
  cache.set("c", c);

  assert.equal(cache.size, EXCEL_WORKBOOK_CACHE_ENTRIES);
  assert.equal(cache.get("a"), a);
  assert.equal(cache.get("b"), null, "b was the least recently used");
  assert.equal(cache.get("c"), c);
});

test("excel workbook cache: the same key replaces rather than duplicates", () => {
  const cache = new ExcelWorkbookCache();
  const first = sheets("first");
  const second = sheets("second", 8);
  cache.set("same", first);
  cache.set("same", second);
  assert.equal(cache.size, 1);
  assert.equal(cache.get("same"), second);
});

test("excel workbook cache: clear removes every file", () => {
  const cache = new ExcelWorkbookCache();
  cache.set("a", sheets());
  cache.set("b", sheets());
  cache.clear();
  assert.equal(cache.size, 0);
  assert.equal(cache.get("a"), null);
});
