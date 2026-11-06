/**
 * Platform baseline gate.
 *
 * `engines.vscode`, `@types/vscode` and `@types/node` describe three different things but
 * are read as one promise: "the API surface this extension may use, and the host it will
 * actually run on". When they drift apart the promise becomes a lie -- the code compiles
 * against 2026 APIs while claiming to support a 2022 host, and `vsce` only compares the
 * *declared* major.minor, so nothing catches it.
 *
 * That is exactly what had happened here (`^1.64.0` declared, 1.144.0 installed), so this
 * gate checks both the declaration and the install. See docs/adr/0003-platform-baseline.md.
 *
 * The second half of the promise is not about versions we write down at all: a *runtime
 * dependency* can declare a Node requirement of its own. If the Node bundled with our
 * minimum VS Code cannot satisfy it, that code path cannot run for the users most likely
 * to break -- and no other gate notices. That is how `puppeteer-core@25` came to require
 * Node >= 22.12 while this manifest claimed to support Node 20.18. See
 * docs/adr/0007-platform-floor-1-125.md.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

/**
 * Node.js bundled with the *minimum* supported VS Code, by release line.
 *
 * The floor matters, not the current stable: `@types/node` newer than the oldest host lets
 * the code call APIs that do not exist for the users most likely to break. Full versions,
 * not majors -- a dependency that asks for `>=24.16.0` must fail against a host on 24.15.
 *
 * Data per point release: the `electron` entry in `microsoft/vscode@<tag>`'s package.json,
 * then the earliest patch of that Electron major in `releases.electronjs.org/releases.json`.
 * 1.64 -> 13.5.1 -> 14.16.0, 1.70 -> 18.3.5 -> 16.13.2, 1.82 -> 25.8.0 -> 18.15.0,
 * 1.90 -> 29.4.0 -> 20.9.0, 1.100 -> 34.5.1 -> 20.18.1, 1.105 -> 37.6.0 -> 22.16.0,
 * 1.125 -> 42.2.0 -> 24.15.0.
 */
const HOST_NODE_BY_MINOR = [
  [64, "14.16.0"],
  [70, "16.13.2"],
  [82, "18.15.0"],
  [90, "20.9.0"],
  [100, "20.18.1"],
  [105, "22.16.0"],
  [125, "24.15.0"],
];

const problems = [];

function fail(message) {
  problems.push(message);
}

function parseVersion(version) {
  const match = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(version ?? "");
  return match ? [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)] : undefined;
}

function format(version) {
  return version.join(".");
}

function compare(left, right) {
  for (let index = 0; index < 3; index++) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function majorMinor(version) {
  const parsed = parseVersion(version);
  return parsed ? [parsed[0], parsed[1]] : undefined;
}

function majorMinorKey(version) {
  const parsed = majorMinor(version);
  return parsed ? `${parsed[0]}.${parsed[1]}` : undefined;
}

function hostNodeFor([major, minor]) {
  if (major !== 1) return undefined;
  let result;
  for (const [line, node] of HOST_NODE_BY_MINOR) {
    if (minor >= line) result = node;
  }
  return result;
}

/**
 * The lowest Node a semver range accepts. Only the lower bound is extracted: an `engines`
 * range with an upper bound is rare, and a host newer than a declared maximum is still a
 * working host in practice. `>=14 || >=18` yields 14, which is the right answer for "can
 * the host run this at all" -- the host satisfies some branch if it is at least the floor
 * of the branch, and the floor of the disjunction is its smallest alternative.
 */
function minimumNode(range) {
  if (typeof range !== "string") return undefined;
  const tokens = range.match(/\d+(?:\.\d+){0,2}/g);
  if (!tokens) return undefined;
  let lowest;
  for (const token of tokens) {
    const parsed = parseVersion(token);
    if (!lowest || compare(parsed, lowest) < 0) lowest = parsed;
  }
  return lowest;
}

function readInstalledPackage(name) {
  try {
    return JSON.parse(readFileSync(join(root, "node_modules", name, "package.json"), "utf8"));
  } catch {
    return undefined;
  }
}

function installedVersion(name) {
  return readInstalledPackage(name)?.version;
}

const engines = manifest.engines?.vscode;
const vscodeRange = manifest.devDependencies?.["@types/vscode"];
const nodeRange = manifest.devDependencies?.["@types/node"];

if (!engines) fail("package.json has no engines.vscode");
if (!vscodeRange) fail("package.json has no devDependency on @types/vscode");
if (!nodeRange) fail("package.json has no devDependency on @types/node");

if (problems.length === 0) {
  const enginesLine = majorMinor(engines.replace(/^[\^~>=<\s]+/, ""));
  const declaredVscodeLine = majorMinor(vscodeRange.replace(/^[\^~>=<\s]+/, ""));

  if (!enginesLine) fail(`engines.vscode "${engines}" is not a plain version range`);
  if (!declaredVscodeLine) fail(`@types/vscode "${vscodeRange}" is not a plain version range`);

  if (enginesLine && declaredVscodeLine && majorMinorKey(engines) !== majorMinorKey(vscodeRange)) {
    fail(
      `engines.vscode is ${enginesLine.join(".")} but @types/vscode declares ${declaredVscodeLine.join(".")}` +
        " -- they must be the same major.minor",
    );
  }

  // The installed tree is what tsc actually reads. A caret range makes the declaration
  // look fine while resolving to a much newer API surface, which is the bug this gate
  // exists to prevent.
  const installedVscode = installedVersion("@types/vscode");
  const installedVscodeLine = installedVscode && majorMinor(installedVscode);
  if (!installedVscodeLine) {
    fail("@types/vscode is not installed -- run pnpm install");
  } else if (enginesLine && installedVscodeLine.join(".") !== enginesLine.join(".")) {
    fail(
      `@types/vscode resolves to ${installedVscode} but engines.vscode is ${enginesLine.join(".")}` +
        " -- pin it with ~ so the two cannot drift",
    );
  }

  const hostNode = enginesLine && hostNodeFor(enginesLine);
  if (enginesLine && hostNode === undefined) {
    fail(`no Node.js mapping for VS Code ${enginesLine.join(".")} -- extend HOST_NODE_BY_MINOR`);
  }

  const declaredNode = parseVersion(nodeRange.replace(/^[\^~>=<\s]+/, ""));
  const installedNode = parseVersion(installedVersion("@types/node"));

  // Major only, on purpose. `@types/node` minors track Node *patch* releases (24.19.2
  // describes a 24.19 runtime), while the host is whatever Electron shipped with. Demanding
  // an exact minor would pin the types to one VS Code patch and make the gate brittle
  // without buying real safety: the API surface the types unlock moves with the major line,
  // and a new API inside the same line is what `@types` resolves by minor drift anyway.
  // Runtime dependencies below are compared at full precision, where `>=X.Y` is strict.
  for (const [label, version] of [
    ["@types/node (declared)", declaredNode],
    ["@types/node (installed)", installedNode],
  ]) {
    if (!version) {
      fail(`${label} is missing or unparsable`);
    } else if (hostNode && version[0] > parseVersion(hostNode)[0]) {
      fail(
        `${label} targets Node ${version[0]} but the minimum supported VS Code ` +
          `(${enginesLine.join(".")}) hosts Node ${hostNode}` +
          " -- raise engines.vscode or lower @types/node",
      );
    }
  }

  // Every runtime dependency must actually be runnable on that host.
  const host = hostNode && parseVersion(hostNode);
  let checked = 0;
  if (host && enginesLine) {
    for (const name of Object.keys(manifest.dependencies ?? {}).sort()) {
      const installed = readInstalledPackage(name);
      const required = minimumNode(installed?.engines?.node);
      if (!required) continue;
      checked++;
      if (compare(required, host) > 0) {
        fail(
          `${name}@${installed.version} requires Node ${format(required)}` +
            ` (engines.node "${installed.engines.node}") but the minimum supported VS Code ` +
            `(${enginesLine.join(".")}) hosts Node ${hostNode}`,
        );
      }
    }
  }

  if (problems.length === 0) {
    console.log(
      `baseline: engines ${enginesLine.join(".")} ≡ @types/vscode ${installedVscode} → host Node ${hostNode}; ` +
        `@types/node ${installedVersion("@types/node")} ✓; ` +
        `${checked} runtime dependency engine ranges satisfied ✓`,
    );
  }
}

if (problems.length > 0) {
  console.error("\nbaseline: the platform baseline is inconsistent\n");
  for (const problem of problems) console.error(`  ${problem}`);
  console.error("\nFix package.json, or update the mapping in scripts/check-baseline.mjs.");
  process.exit(1);
}
