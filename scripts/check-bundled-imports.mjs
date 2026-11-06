/**
 * Fail the build when a **bare** dynamic `import()` of an external package survives into the
 * bundled output.
 *
 * Why this exists: `build.ts` ships the heavy runtime dependencies as flat files under
 * `out/node_modules/<name>.js` and marks them `external`. Node's CommonJS resolver appends
 * `.js` (`require("highlight.js")` → `out/node_modules/highlight.js.js`), but the **ESM**
 * resolver does not — and it also happily walks up parent directories, so a probe run inside
 * the repo finds the real `node_modules/highlight.js` and reports success. The same probe run
 * from a copy of `out/` alone fails with `ERR_MODULE_NOT_FOUND`.
 *
 * That is exactly how "Export PDF/HTML" would have broken in the *installed* extension while
 * every local check stayed green: an `await import("highlight.js")` that type checks, bundles,
 * and passes tests from the repo. Static `import` is safe — esbuild lowers it to `require()`.
 *
 * Relative specifiers are allowed: they resolve against `out/` and work in both worlds.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const bundles = ["out/extension.js"];

/**
 * Bare dynamic imports that are known to be unreachable, with the reason. Adding an entry is a
 * deliberate act: it asserts "this code path never executes in the packaged extension".
 */
const KNOWN_UNREACHABLE = {
  katex: "mermaid legacy MathML branch; the exporter only calls mermaid.parse(), never render()",
};

const problems = [];

for (const bundle of bundles) {
  const source = readFileSync(join(process.cwd(), bundle), "utf8");
  for (const match of source.matchAll(/\bimport\(\s*(["'])([^"']+)\1\s*\)/g)) {
    const specifier = match[2];
    if (specifier.startsWith(".") || specifier.startsWith("node:")) {
      continue;
    }
    if (Object.hasOwn(KNOWN_UNREACHABLE, specifier)) {
      continue;
    }
    problems.push(`${bundle}: dynamic import("${specifier}")`);
  }
}

if (problems.length > 0) {
  console.error("A bare dynamic import() will not resolve from the packaged layout:");
  for (const problem of problems) {
    console.error("  " + problem);
  }
  console.error("");
  console.error(
    "Use a static import instead: esbuild turns it into require(), which resolves the flat",
  );
  console.error("out/node_modules/<name>.js files. See scripts/check-bundled-imports.mjs.");
  process.exit(1);
}

console.log(`bundled imports: ${bundles.join(", ")} clean (no bare dynamic import())`);
