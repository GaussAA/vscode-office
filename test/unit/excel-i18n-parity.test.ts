import assert from "node:assert/strict";
import test from "node:test";
import en from "@/react/view/excel/x-spreadsheet/locale/en.js";
import zhCn from "@/react/view/excel/x-spreadsheet/locale/zh-cn.js";
import zhTw from "@/react/view/excel/x-spreadsheet/locale/zh-tw.js";

/**
 * The vendored x-spreadsheet locale keys are not validated by i18n-parity.test (which only scans
 * $t), so this test ensures the three locale files have matching keys. Missing or extra keys
 * cause translation fallbacks or render empty strings.
 */

function flattenKeys(obj: any, prefix = ""): string[] {
  const keys: string[] = [];
  for (const key of Object.keys(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const value = obj[key];
    if (value != null && typeof value === "object" && !Array.isArray(value)) {
      keys.push(...flattenKeys(value, path));
    } else {
      keys.push(path);
    }
  }
  return keys.sort();
}

test("excel locale: en, zh-cn, zh-tw have the same key sets", () => {
  const enKeys = flattenKeys(en);
  const zhCnKeys = flattenKeys(zhCn);
  const zhTwKeys = flattenKeys(zhTw);

  assert.deepEqual(zhCnKeys, enKeys, "zh-cn keys must match en");
  assert.deepEqual(zhTwKeys, enKeys, "zh-tw keys must match en");
});

test("excel locale: no key has an empty string value", () => {
  const check = (obj: any, path: string) => {
    for (const [key, value] of Object.entries(obj)) {
      const fullPath = path ? `${path}.${key}` : key;
      if (typeof value === "string") {
        assert.ok(value.trim(), `${fullPath} is empty`);
      } else if (value != null && typeof value === "object" && !Array.isArray(value)) {
        check(value, fullPath);
      }
    }
  };
  check(en, "en");
  check(zhCn, "zh-cn");
  check(zhTw, "zh-tw");
});
