import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * `vscode.l10n` resolves `l10n/bundle.l10n.json` at runtime, from inside the extension host.
 * That resolution cannot be exercised from a `node:test` file, and the smoke test's module
 * belongs to a different "extension" than the one under test, so it only ever saw the identity
 * fallback. What is checkable here is the part that used to break silently: the bundles must
 * agree with each other and with the keys the code actually asks for.
 */

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const read = (path) => JSON.parse(readFileSync(join(root, path), "utf8"));
const manifest = read("package.json");
const base = read("l10n/bundle.l10n.json");
const localeFiles = readdirSync(join(root, "l10n")).filter((name) =>
  /^bundle\.l10n\..+\.json$/.test(name),
);

/** Extension-side lookups only: the webview has its own i18n module. */
function keysUsedByExtension() {
  const sources = [];
  const walk = (dir) => {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (path !== "src/react") walk(path);
      } else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
        sources.push(path);
      }
    }
  };
  walk("src");
  const keys = new Set();
  for (const file of sources) {
    for (const match of readFileSync(join(root, file), "utf8").matchAll(
      /\bi18n\(\s*['"]([^'"]+)['"]/g,
    )) {
      keys.add(match[1]);
    }
  }
  return [...keys].sort((a, b) => a.localeCompare(b));
}

test("l10n: package.json points the host at the bundle folder", () => {
  assert.strictEqual(manifest.l10n, "./l10n");
});

test("l10n: every key the extension asks for exists", () => {
  const missing = keysUsedByExtension().filter((key) => !(key in base));
  assert.deepStrictEqual(
    missing,
    [],
    `keys missing from l10n/bundle.l10n.json: ${missing.join(", ")}`,
  );
});

test("l10n: no locale bundle drops or invents a key", () => {
  const expected = Object.keys(base).sort();
  for (const file of localeFiles) {
    const bundle = read(`l10n/${file}`);
    assert.deepStrictEqual(
      Object.keys(bundle).sort(),
      expected,
      `${file} does not match the English key set`,
    );
  }
});

test("l10n: placeholders were converted and stay contiguous", () => {
  // The old formatter used `$1`, l10n uses `{0}`. A half-converted bundle renders the
  // literal `$1` to the user, which is exactly the kind of thing nobody notices in review.
  const files = ["l10n/bundle.l10n.json", ...localeFiles.map((file) => `l10n/${file}`)];
  for (const file of files) {
    const bundle = read(file);
    for (const [key, text] of Object.entries(bundle)) {
      assert.ok(!/\$\d/.test(text), `${file}: ${key} still uses $N placeholders`);
      const indices = [...text.matchAll(/\{(\d+)\}/g)].map((match) => Number(match[1]));
      const unique = [...new Set(indices)].sort((a, b) => a - b);
      assert.deepStrictEqual(
        unique,
        unique.map((_, position) => position),
        `${file}: ${key} has non-contiguous placeholders`,
      );
    }
  }
});

test("l10n: no locale file is left empty", () => {
  assert.ok(
    localeFiles.length >= 9,
    `expected the nine shipped locales, found ${localeFiles.length}`,
  );
});
