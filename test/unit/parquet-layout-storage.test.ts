import { test } from "node:test";
import assert from "node:assert/strict";
import { parseStoredColumnWidths } from "../../src/react/view/parquet/useParquetColumnLayout";
import { parseStoredSiderWidth } from "../../src/react/view/parquet/useParquetSiderResize";

test("parquet sider storage: out-of-range and malformed values fall back to the default", () => {
  assert.equal(parseStoredSiderWidth("300"), 300);
  assert.equal(parseStoredSiderWidth("999"), 260);
  assert.equal(parseStoredSiderWidth("nope"), 260);
  assert.equal(parseStoredSiderWidth(null), 260);
});

test("parquet column storage: only finite widths inside the resize bounds survive", () => {
  assert.deepEqual(parseStoredColumnWidths('{"a":120,"b":63,"c":481,"d":"wide","e":null}'), {
    a: 120,
  });
  assert.deepEqual(parseStoredColumnWidths("{"), {});
  assert.deepEqual(parseStoredColumnWidths("null"), {});
});
