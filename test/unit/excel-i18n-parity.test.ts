import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
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

function hasKey(obj: any, key: string): boolean {
  const parts = key.split(".");
  let current = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object" || !(part in current)) return false;
    current = current[part];
  }
  return true;
}

function walkFiles(dir: string, pattern: RegExp): string[] {
  const results: string[] = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFiles(path, pattern));
    } else if (pattern.test(entry.name)) {
      results.push(path);
    }
  }
  return results;
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

/**
 * Static keys used by the excel viewer: `t("a.b")` / `t('a.b', arg...)` and the lazy `tf("a.b")`
 * in the vendored grid. Keys built at runtime (`t(\`button.${title}\`)` and friends) cannot be
 * scanned; the key-set parity test above is what protects those.
 */
const T_CALL = /(?<![\w$.])tf?\(\s*(["'])([\w.]+)\1/g;

/** Commented-out code (the vendored formula.js keeps disabled DIVIDE/PRODUCT/SUBTRACT) is not a call site. */
export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
}

function usedKeys(): Map<string, string> {
  const here = dirname(fileURLToPath(import.meta.url));
  const root = join(here, "..", "..", "src", "react", "view", "excel");
  const used = new Map<string, string>();
  for (const file of walkFiles(root, /\.(ts|tsx|js)$/)) {
    const rel = relative(root, file).replaceAll("\\", "/");
    if (rel.startsWith("x-spreadsheet/locale/")) continue;
    for (const match of stripComments(readFileSync(file, "utf8")).matchAll(T_CALL)) {
      if (!used.has(match[2])) used.set(match[2], rel);
    }
  }
  return used;
}

test("excel locale: the scan finds the call sites it is supposed to guard", () => {
  const used = usedKeys();
  assert.ok(used.size >= 60, `only ${used.size} keys found; the pattern probably stopped matching`);
  // One with extra arguments, one from the windowed view, one lazy `tf` key from the vendored grid.
  assert.ok(used.has("viewer.tooLargeBody"), "t(key, ...args) must be matched");
  assert.ok(used.has("viewer.resizeColumn"), "windowed view keys must be matched");
  assert.ok(used.has("contextmenu.copy"), "tf(key) in vendored code must be matched");
});

test("excel locale: commented-out t() calls are not call sites", () => {
  const source = [
    '/* title: tf("formula.divide"), */',
    '// t("formula.product")',
    'const live = t("formula.sum");',
    'const url = "https://x.test"; t("formula.and");',
  ].join("\n");
  const keys = [...stripComments(source).matchAll(T_CALL)].map((match) => match[2]);
  assert.deepEqual(keys, ["formula.sum", "formula.and"]);
});

test("excel locale: every key the source uses exists in en, zh-cn and zh-tw", () => {
  const missing: string[] = [];
  for (const [key, file] of usedKeys()) {
    for (const [name, locale] of [
      ["en", en],
      ["zh-cn", zhCn],
      ["zh-tw", zhTw],
    ] as const) {
      if (!hasKey(locale, key)) missing.push(`${name}: ${key} (${file})`);
    }
  }
  assert.deepEqual(missing, []);
});
