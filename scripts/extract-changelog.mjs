#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Extract the CHANGELOG.md section for a given version.
 * Usage: node scripts/extract-changelog.mjs 6.4.5
 * Output: the content between ## [6.4.5] and the next ## [, without the version header line.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const version = process.argv[2];
if (!version) {
  console.error("Usage: node scripts/extract-changelog.mjs <version>");
  process.exit(1);
}

const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf8");
const pattern = new RegExp(
  `## \\[${version.replace(/\./g, "\\.")}\\][^\\n]*\\n([\\s\\S]*?)\\n## \\[`,
  "m",
);
const match = changelog.match(pattern);
if (!match) {
  console.error(`Version ${version} not found in CHANGELOG.md`);
  process.exit(1);
}
console.log(match[1].trim());
