import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Registration has several touch points and nothing used to check that they agree, so
 * drifts shipped unnoticed: a provider registered for a viewType nobody contributes, a
 * React route missing from the UI suite, and a duplicated file pattern. These tests turn
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
 * The scenarios used to live in `runner.mjs`; scanning only that file would have made the
 * coverage test below pass on an empty set the moment they moved.
 */
const scenarioSources = (): string => {
  const dir = "scripts/ui-verify/scenarios";
  const modules = readdirSync(join(root, dir))
    .filter((name) => name.endsWith(".mjs"))
    .map((name) => read(`${dir}/${name}`));
  return [read("scripts/ui-verify/runner.mjs"), ...modules].join("\n");
};

/**
 * The scenario that owns each React route. Every route on its own also proves the view mounts,
 * so a route with no scenario is a view nothing renders outside VS Code (ADR-0014 warned that
 * registration, contribution and the UI suite have to move together).
 */
const DEDICATED_SCENARIOS: Record<string, string> = {
  parquet: "parquet-paging",
  jsonl: "jsonl-directory",
  json: "json-records",
  compare: "compare-same-schema",
};

/** Routes `src/react/main.tsx` actually handles. */
function mainRoutes(): string[] {
  return [...read("src/react/main.tsx").matchAll(/case\s+['"]([^'"]+)['"]:/g)].map(
    (match) => match[1],
  );
}

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

const providerFiles = walk("src/provider", [".ts"]);
const providerTypes = new Set<string>();
for (const file of providerFiles) {
  const text = read(file);
  for (const type of literalViewTypes(text)) providerTypes.add(type);
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

test("every React route has a scenario that renders it", () => {
  const routes = mainRoutes();
  assert.ok(routes.length >= 4, "the route switch should still have its cases");

  const runner = scenarioSources();
  // The source is formatted by oxfmt, which emits double quotes — every scraper in this file
  // accepts either style so a format pass can never silently empty a scan.
  const hasScenario = (name: string) => new RegExp(`name:\\s*['"]${name}['"]`).test(runner);

  const uncovered = routes.filter((route) => {
    const scenario = DEDICATED_SCENARIOS[route];
    return !(scenario && hasScenario(scenario));
  });

  assert.deepEqual(
    uncovered,
    [],
    "give the route a scenario and list it in `DEDICATED_SCENARIOS`, or nothing renders it outside VS Code",
  );
});

test("the scenario table names only routes main.tsx handles", () => {
  const known = new Set(mainRoutes());
  const unknown = Object.keys(DEDICATED_SCENARIOS).filter((route) => !known.has(route));
  assert.deepEqual(unknown, [], "a mapping for a route main.tsx does not handle can never run");
});
