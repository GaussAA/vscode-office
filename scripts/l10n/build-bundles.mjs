import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * One-off: turn the hand-rolled `package.nls.*.json` runtime bundles into the layout
 * `vscode.l10n` expects (`l10n/bundle.l10n.<locale>.json`), converting the `$1` placeholders
 * of the old formatter into `{0}`. Kept in the repo so the mapping is auditable rather than a
 * diff nobody can reproduce.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const outDir = join(root, "l10n");
mkdirSync(outDir, { recursive: true });

/** `$1` → `{0}`: the old formatter was 1-based, l10n is 0-based. */
const convertPlaceholders = (text) =>
  text.replace(/\$(\d+)/g, (_, digits) => `{${Number(digits) - 1}}`);

const convert = (source) =>
  Object.fromEntries(
    Object.entries(JSON.parse(readFileSync(join(root, source), "utf8"))).map(([key, value]) => [
      key,
      convertPlaceholders(value),
    ]),
  );

const english = convert("package.nls.json");
writeFileSync(join(outDir, "bundle.l10n.json"), `${JSON.stringify(english, null, 2)}\n`);

const localeFiles = readdirSync(root).filter((name) => /^package\.nls\.[a-z-]+\.json$/.test(name));
for (const file of localeFiles) {
  const locale = file.replace("package.nls.", "").replace(".json", "");
  const bundle = { ...english, ...convert(file) };
  writeFileSync(join(outDir, `bundle.l10n.${locale}.json`), `${JSON.stringify(bundle, null, 2)}\n`);
}

console.log(
  `wrote bundle.l10n.json + ${localeFiles.length} locale bundles (${localeFiles.join(", ")})`,
);
