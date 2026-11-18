import assert from "node:assert/strict";
import test from "node:test";
import { createExcelWorkbookHost, type ExcelWorkbookStat } from "@/provider/excelWorkbookHost";
import { ExcelWorkbookCache, excelWorkbookCacheKey } from "@/service/excelWorkbookCache";
import type { WorkbookSheetRows } from "@/common/workbookRows";

function sheets(): WorkbookSheetRows[] {
  return [
    {
      name: "Data",
      rows: [
        ["id", "name"],
        ["0", "alpha"],
        ["1", "beta"],
      ],
    },
  ];
}

function harness(stat: ExcelWorkbookStat | null) {
  const cache = new ExcelWorkbookCache();
  const emitted: Array<{ type: string; payload: any }> = [];
  let current = stat;
  const host = createExcelWorkbookHost({
    documentCacheId: "file:a.xlsx",
    cache,
    stat: async () => current,
    emit: (type, payload) => emitted.push({ type, payload }),
  });
  return { host, cache, emitted, setStat: (value: ExcelWorkbookStat | null) => (current = value) };
}

test("excel workbook host: open misses, store fills, next open returns metadata", async () => {
  const { host, emitted } = harness({ size: 1024, mtimeMs: 10 });
  await host.open({ requestId: 1 });
  assert.equal(emitted[0]?.type, "excelWorkbookMeta");
  assert.equal(emitted[0]?.payload.missing, true);

  await host.store({ sheets: sheets() });
  await host.open({ requestId: 2 });
  const hit = emitted.at(-1)?.payload;
  assert.equal(hit.missing, undefined);
  assert.equal(typeof hit.key, "string");
  assert.deepEqual(hit.sheets, [{ name: "Data", rowCount: 3, columnCount: 2 }]);
});

test("excel workbook host: rows returns the requested window and clamps it", async () => {
  const { host, emitted, cache } = harness({ size: 1024, mtimeMs: 10 });
  await host.store({ sheets: sheets() });
  const key = excelWorkbookCacheKey({ key: "file:a.xlsx", size: 1024, mtimeMs: 10 });

  await host.rows({ requestId: 3, key, sheetIndex: 0, start: 1, end: 99 });
  assert.deepEqual(emitted.at(-1)?.payload.rows, [
    ["0", "alpha"],
    ["1", "beta"],
  ]);

  cache.clear();
  await host.rows({ requestId: 4, key, sheetIndex: 0, start: 0, end: 1 });
  assert.match(emitted.at(-1)?.payload.error, /gone/);
});

test("excel workbook host: a changed fingerprint misses the old entry", async () => {
  const { host, emitted, setStat } = harness({ size: 1024, mtimeMs: 10 });
  await host.store({ sheets: sheets() });
  setStat({ size: 1025, mtimeMs: 11 });
  await host.open({ requestId: 5 });
  assert.equal(emitted.at(-1)?.payload.missing, true);
  assert.match(emitted.at(-1)?.payload.key, /:1025:11:/);
});

test("excel workbook host: files over the windowed source cap are not cached", async () => {
  const { host, cache, emitted } = harness({ size: 16 * 1024 * 1024, mtimeMs: 10 });
  await host.store({ sheets: sheets() });
  assert.equal(cache.size, 0);
  await host.open({ requestId: 6 });
  assert.equal(emitted.at(-1)?.payload.missing, true);
});

test("excel workbook host: no stat means no cache and no rows", async () => {
  const { host, cache, emitted } = harness(null);
  await host.store({ sheets: sheets() });
  assert.equal(cache.size, 0);
  await host.open({ requestId: 7 });
  assert.equal(emitted.at(-1)?.payload.missing, true);
});
