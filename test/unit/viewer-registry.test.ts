import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Registration has several touch points and nothing used to check that they agree, so
 * drifts shipped unnoticed: a provider registered for a viewType nobody contributes, a
 * React route missing from the smoke list, and a duplicated file pattern. These tests turn
 * that silence into a red build.
 */

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const read = (path: string): string => readFileSync(join(root, path), "utf8");

interface CustomEditorContribution {
  viewType: string;
  selector: Array<{ filenamePattern?: string }>;
}

interface Manifest {
  contributes: { customEditors: CustomEditorContribution[] };
}

const readManifest = (): Manifest => JSON.parse(read("package.json")) as Manifest;

/**
 * Every UI scenario source: the runner's driver plus the modules it imports.
 *
 * The scenarios used to live in `runner.mjs`; scanning only that file would have made these two
 * coverage tests pass on an empty set the moment they moved.
 */
const scenarioSources = (): string => {
  const dir = "scripts/ui-verify/scenarios";
  const modules = readdirSync(join(root, dir))
    .filter((name) => name.endsWith(".mjs"))
    .map((name) => read(`${dir}/${name}`));
  return [read("scripts/ui-verify/runner.mjs"), ...modules].join("\n");
};

function walk(dir: string, extensions: string[]): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(root, dir))) {
    const path = join(dir, entry);
    if (statSync(join(root, path)).isDirectory()) out.push(...walk(path, extensions));
    else if (extensions.some((extension) => path.endsWith(extension))) out.push(path);
  }
  return out;
}

/** `registerCustomEditorProvider('<viewType>'` anywhere in a file. */
function literalViewTypes(text: string): string[] {
  return [...text.matchAll(/registerCustomEditorProvider\(\s*['"]([^'"]+)['"]/g)].map(
    (match) => match[1],
  );
}

/** The desktop-only list the web entry re-registers as an "unsupported" screen. */
function unsupportedViewTypes(text: string): string[] {
  const block = /WEB_UNSUPPORTED_VIEW_TYPES\s*=\s*\[([\s\S]*?)\]/.exec(text);
  if (!block) return [];
  return [...block[1].matchAll(/['"]([^'"]+)['"]/g)].map((match) => match[1]);
}

const providerFiles = walk("src/provider", [".ts"]);
const providerTypes = new Set<string>();
for (const file of providerFiles) {
  const text = read(file);
  for (const type of literalViewTypes(text)) providerTypes.add(type);
  for (const type of unsupportedViewTypes(text)) providerTypes.add(type);
}

/** viewTypes the given entry point registers, following `x.bindCustomEditors(...)` one hop. */
function registeredBy(entryFile: string): Set<string> {
  const text = read(entryFile);
  const types = new Set<string>(literalViewTypes(text));

  for (const match of text.matchAll(/(\w+)\.bindCustomEditors?\(/g)) {
    const variable = match[1];
    const ctor = new RegExp(`const ${variable}\\s*=\\s*new\\s+(\\w+)`).exec(text);
    if (!ctor) continue;
    const className = ctor[1];
    const file = providerFiles.find((candidate: string) =>
      read(candidate).includes(`class ${className}`),
    );
    assert.ok(
      file,
      `${entryFile} binds ${variable} (${className}) but no provider file declares it`,
    );
    const providerText = read(file);
    for (const type of literalViewTypes(providerText)) types.add(type);
    for (const type of unsupportedViewTypes(providerText)) types.add(type);
  }
  return types;
}

test("every contributed custom editor is registered somewhere", () => {
  const pkg = readManifest();
  const contributed = pkg.contributes.customEditors.map(
    (editor: CustomEditorContribution) => editor.viewType,
  );
  const desktop = registeredBy("src/extension.ts");
  const missing = contributed.filter((type) => !desktop.has(type));
  assert.deepEqual(
    missing,
    [],
    "a contribution with no provider is an editor that opens to nothing",
  );
});

test("every registered provider is contributed", () => {
  const pkg = readManifest();
  const contributed = new Set(pkg.contributes.customEditors.map((editor) => editor.viewType));
  const invisible = [...providerTypes].filter((type) => !contributed.has(type));
  assert.deepEqual(
    invisible,
    [],
    "a registered viewType nobody contributes is unreachable from the UI",
  );
});

test("no viewType declares the same file pattern twice", () => {
  const pkg = readManifest();
  const duplicates: string[] = [];
  for (const editor of pkg.contributes.customEditors) {
    const patterns = editor.selector.flatMap((selector) =>
      String(selector.filenamePattern ?? "")
        .split(",")
        .map((pattern) => pattern.trim()),
    );
    const seen = new Set();
    for (const pattern of patterns) {
      if (!pattern) continue;
      if (seen.has(pattern)) duplicates.push(`${editor.viewType}: ${pattern}`);
      seen.add(pattern);
    }
  }
  assert.deepEqual(duplicates, []);
});

test("every React route is covered by the smoke list or a dedicated scenario", () => {
  const mainRouteText = read("src/react/main.tsx");
  const routes = [...mainRouteText.matchAll(/case\s+['"]([^'"]+)['"]:/g)].map((match) => match[1]);
  assert.ok(routes.length >= 4, "the route switch should still have its cases");

  const runner = scenarioSources();
  const smokeBlock = /const routes = \[([\s\S]*?)\]/.exec(runner);
  assert.ok(smokeBlock, "the smoke scenario should build its routes from a literal array");
  const smoked = new Set([...smokeBlock[1].matchAll(/['"]([^'"]+)['"]/g)].map((match) => match[1]));

  // Routes that get their own scenario instead of the mount-only smoke.
  const dedicated: Record<string, string> = {
    parquet: "parquet-paging",
    jsonl: "jsonl-directory",
    json: "json-records",
  };

  // The source is formatted by oxfmt, which emits double quotes — every scraper in this file
  // accepts either style so a format pass can never silently empty a scan.
  const hasScenario = (name: string) => new RegExp(`name:\\s*['"]${name}['"]`).test(runner);

  const uncovered = routes.filter((route) => {
    if (smoked.has(route)) return false;
    const scenario = dedicated[route];
    return !(scenario && hasScenario(scenario));
  });

  assert.deepEqual(
    uncovered,
    [],
    "add the route to the smoke list, or give it a scenario and list it in `dedicated`",
  );
});

test("the smoke list names routes that actually exist", () => {
  const runner = scenarioSources();
  const smokeBlock = /const routes = \[([\s\S]*?)\]/.exec(runner);
  assert.ok(smokeBlock, "the smoke scenario should build its routes from a literal array");
  const smoked = [...smokeBlock[1].matchAll(/['"]([^'"]+)['"]/g)].map((match) => match[1]);
  const known = new Set(
    [...read("src/react/main.tsx").matchAll(/case\s+['"]([^'"]+)['"]:/g)].map((match) => match[1]),
  );
  const unknown = smoked.filter((route) => !known.has(route));
  assert.deepEqual(unknown, [], "a smoke route that main.tsx does not handle can never mount");
});
