import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Preflight for a release tag. Everything here is checkable without credentials, and every
 * item below has a real failure mode that only shows up *after* a tag is pushed — which is
 * the worst time to learn about it, because a failed publish leaves a version number half
 * spent. Run it locally before tagging; CI runs it again on the tag.
 *
 * The two things it cannot check are the ones that need a browser session: the Marketplace
 * trusted-publishing policy and the Open VSX trusted publisher. See
 * `docs/release/trusted-publishing.md`.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const problems = [];
const fail = (message) => problems.push(message);

const read = (relative) => readFileSync(join(root, relative), "utf8");
const manifest = JSON.parse(read("package.json"));

if (!manifest.publisher) fail('package.json has no "publisher"; vsce cannot publish');
if (!/^\d+\.\d+\.\d+$/.test(manifest.version ?? "")) {
  fail(
    `package.json version "${manifest.version}" is not major.minor.patch (the Marketplace rejects prerelease tags)`,
  );
}
if (!manifest.repository?.url)
  fail('package.json has no "repository.url"; the Marketplace page links break');
if (!manifest.license) fail('package.json has no "license" field');

/**
 * Case-sensitive existence check. `existsSync` is not enough: this script runs on Windows in
 * development and on Linux in CI, and the two disagree about `changelog.md` vs `CHANGELOG.md`.
 * Checking the directory listing makes the local run say what CI will say. (It did not, once:
 * the lowercase file passed here and failed the release workflow on the tag.)
 */
function existsExact(relativePath) {
  const segments = relativePath.split("/");
  let current = root;
  for (const segment of segments) {
    let entries;
    try {
      entries = readdirSync(current);
    } catch {
      return false;
    }
    if (!entries.includes(segment)) return false;
    current = join(current, segment);
  }
  return true;
}

for (const file of ["README.md", "LICENSE", "CHANGELOG.md"]) {
  // vsce looks these up by exact name and only `CHANGELOG.md` reaches the Marketplace tab.
  if (!existsExact(file))
    fail(`${file} is missing; vsce packages without it but the listing looks broken`);
}

const icon = manifest.icon;
if (!icon) {
  fail('package.json has no "icon"');
} else if (!existsExact(icon)) {
  fail(`icon "${icon}" does not exist`);
} else if (!icon.toLowerCase().endsWith(".png")) {
  fail(`icon "${icon}" must be a PNG; the Marketplace rejects SVG icons`);
} else if (iconSize(join(root, icon)).width < 128) {
  fail(`icon "${icon}" is narrower than 128px`);
}

// `vscode.l10n` resolves `l10n/bundle.l10n*.json` from the packaged extension.
if (!existsExact("l10n/bundle.l10n.json")) fail("l10n/bundle.l10n.json is missing");
if (manifest.l10n !== "./l10n") fail('package.json "l10n" must point at "./l10n"');

const workflow = read(join(".github", "workflows", "release.yml"));
// Comments are stripped first: the file explains the PAT retirement at length, and matching
// against prose made the check fire on its own documentation.
const workflowCode = workflow
  .split("\n")
  .filter((line) => !/^\s*#/.test(line))
  .join("\n");
for (const [needle, why] of [
  ["id-token: write", "without it no OIDC token can be requested and both publishes fail"],
  ["--oidc", "vsce must publish with OIDC, not a PAT"],
  ["--trusted-publishing", "ovsx must publish with trusted publishing, not a PAT"],
]) {
  if (!workflowCode.includes(needle))
    fail(`.github/workflows/release.yml is missing "${needle}": ${why}`);
}
if (/VSCE_PAT|OVSX_PAT/.test(workflowCode)) {
  fail("release.yml still references a stored PAT; trusted publishing does not fall back to one");
}

const tag = process.argv.find((argument) => argument.startsWith("--tag="))?.slice("--tag=".length);
if (tag !== undefined) {
  if (tag !== `v${manifest.version}`) {
    fail(`tag "${tag}" does not match the packaged version "v${manifest.version}"`);
  }
}

if (problems.length > 0) {
  console.error("release preflight failed:");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(`release preflight ok (v${manifest.version})`);

/** PNG IHDR width, so a 32px icon is caught before the Marketplace rejects it. */
function iconSize(path) {
  const bytes = readFileSync(path);
  const signatureOk = bytes
    .subarray(0, 8)
    .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (!signatureOk || bytes.length < 24) return { width: 0 };
  return { width: bytes.readUInt32BE(16) };
}
