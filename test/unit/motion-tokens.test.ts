import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

/**
 * Motion tokens are a contract, not a style preference (ADR-0022, ADR-0023): a literal duration
 * is one the `prefers-reduced-motion` media query cannot zero, so it silently leaves some users
 * with an animation they asked the system to remove.
 *
 * A grep is the honest guard here. A DOM scenario can only sample the elements that happen to
 * render in one screenshot; this reads every stylesheet in the tree.
 */
const ROOT = join(import.meta.dirname, "..", "..", "src", "react");

function lessFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...lessFiles(path));
    else if (entry.name.endsWith(".less")) out.push(path);
  }
  return out;
}

const LITERAL_DURATION = /(?:transition|animation(?:-duration)?)[^;{}]*?\b\d*\.?\d+m?s\b/;

test("no stylesheet declares a literal transition or animation duration", () => {
  const offenders: string[] = [];
  for (const file of lessFiles(ROOT)) {
    const text = readFileSync(file, "utf8");
    for (const [index, line] of text.split(/\r?\n/).entries()) {
      if (!LITERAL_DURATION.test(line)) continue;
      // A looping decoration has no end state to land in, and its own `prefers-reduced-motion`
      // override turns it off entirely — a token would only shorten the loop. Everything else
      // must go through `--motion-*`.
      if (line.includes("infinite")) continue;
      offenders.push(`${file.slice(ROOT.length + 1)}:${index + 1}: ${line.trim()}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "use var(--motion-fast|base|slow) and var(--motion-ease); see src/react/common/motion.less",
  );
});

test("a stylesheet that uses motion tokens imports them", () => {
  const missing: string[] = [];
  for (const file of lessFiles(ROOT)) {
    const text = readFileSync(file, "utf8");
    if (!text.includes("var(--motion-")) continue;
    if (text.includes("motion.less")) continue;
    // The token file itself declares them.
    if (file.endsWith("motion.less")) continue;
    missing.push(file.slice(ROOT.length + 1));
  }
  assert.deepEqual(missing, [], 'add @import "../../common/motion.less"; (adjust the depth)');
});
