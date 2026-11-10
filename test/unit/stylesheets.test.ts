import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";
import test from "node:test";

/**
 * Every stylesheet defines a token layer or a component's look; either way something has to load
 * it. `viewerTheme.css` sat in `src/react/view/common/` defining a fourteen-variable `--viewer-*`
 * layer that nothing imported: the build never emitted it, no component read it, and it made the
 * tree look like it had two competing token systems. This test keeps that from happening again —
 * an orphan stylesheet is dead code that reads like live code.
 */

const root = join(import.meta.dirname, "..", "..");
// The whole source tree. The first version stopped at `src/react` and would have kept a second
// orphan (`src/vscode.css`, host variables spelled for standalone browsing) alive forever.
const stylesheetDirs = [join(root, "src")];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

/** Every .ts/.tsx/.less/.css under src, once. */
const sources = [
  ...new Set(
    stylesheetDirs
      .filter((dir) => statSync(dir, { throwIfNoEntry: false }))
      .flatMap((dir) => walk(dir)),
  ),
];
const code = sources.filter((path) => /\.(ts|tsx)$/.test(path));
const styles = sources.filter((path) => /\.(css|less)$/.test(path));

test("every stylesheet is imported by something", () => {
  const text = code.map((path) => readFileSync(path, "utf8")).join("\n");
  const orphans = styles.filter((path) => {
    const name = basename(path);
    // Imported either as `import "./Name.css"` or via a less `@import`.
    return (
      !text.includes(name) &&
      !styles.some((other) => other !== path && readFileSync(other, "utf8").includes(name))
    );
  });

  assert.deepEqual(
    orphans.map((path) => relative(root, path)),
    [],
    "these stylesheets are never loaded, so they are dead code that reads like a token layer",
  );
});
