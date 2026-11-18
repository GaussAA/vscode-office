import assert from "node:assert/strict";
import test from "node:test";
import {
  createHostWorkbookSource,
  type HostWorkbookMeta,
} from "@/react/view/excel/hostWorkbookSource";

const meta: HostWorkbookMeta = {
  key: "file:a.xlsx:1:2:1",
  sheets: [
    { name: "Data", rowCount: 4, columnCount: 3 },
    { name: "Extra", rowCount: 2, columnCount: 1 },
  ],
};

test("host workbook source: metadata drives the sheet picker and counts", () => {
  const source = createHostWorkbookSource(meta, async () => []);
  assert.equal(source.kind, "workbook");
  assert.deepEqual(source.sheetNames, ["Data", "Extra"]);
  assert.equal(source.sheetIndex, 0);
  assert.equal(source.rowCount, 4);
  assert.equal(source.columnCount, 3);
});

test("host workbook source: readRows clamps and forwards the key/sheet/window", async () => {
  const calls: Array<[string, number, number, number]> = [];
  const source = createHostWorkbookSource(meta, async (key, sheetIndex, start, end) => {
    calls.push([key, sheetIndex, start, end]);
    return [["row"]];
  });

  assert.deepEqual(await source.readRows(1, 3), [["row"]]);
  assert.deepEqual(calls, [[meta.key, 0, 1, 3]]);
  assert.deepEqual(await source.readRows(-5, 99), [["row"]]);
  assert.deepEqual(calls.at(-1), [meta.key, 0, 0, 4]);
  assert.deepEqual(await source.readRows(4, 9), []);
});

test("host workbook source: selectSheet rebinds the window without new metadata", async () => {
  const calls: Array<[string, number, number, number]> = [];
  const source = createHostWorkbookSource(meta, async (key, sheetIndex, start, end) => {
    calls.push([key, sheetIndex, start, end]);
    return [["x"]];
  }).selectSheet(1);

  assert.equal(source.sheetIndex, 1);
  assert.equal(source.rowCount, 2);
  assert.equal(source.columnCount, 1);
  await source.readRows(0, 2);
  assert.deepEqual(calls, [[meta.key, 1, 0, 2]]);
});
