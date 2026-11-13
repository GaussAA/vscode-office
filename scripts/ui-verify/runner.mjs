/**
 * UI verification: build the app, serve it with fake VS Code bridges, drive headless
 * Chrome through Puppeteer, assert the DOM, and write screenshots.
 *
 *   node scripts/ui-verify/runner.mjs                  # assert only
 *   node scripts/ui-verify/runner.mjs --docs           # also refresh docs/screenshots
 *   node scripts/ui-verify/runner.mjs --filter=parquet # only matching scenarios
 *   node scripts/ui-verify/runner.mjs --headed         # watch it run
 *
 * Through pnpm the flags need the separator: `pnpm verify:ui -- --filter=parquet`.
 */
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launchBrowser } from "./browser.mjs";
import { createFixtures, repoRoot } from "./fixtures.mjs";
import { startHarness } from "./harness.mjs";

const rawArgs = process.argv.slice(2);
let filter;
let refreshDocs = false;
let headed = false;
const unknownArgs = [];

for (let index = 0; index < rawArgs.length; index++) {
  const arg = rawArgs[index];
  if (arg.startsWith("--filter=")) {
    filter = arg.slice("--filter=".length);
  } else if (arg === "--filter") {
    filter = rawArgs[++index];
  } else if (arg === "--docs") {
    refreshDocs = true;
  } else if (arg === "--headed") {
    headed = true;
  } else {
    unknownArgs.push(arg);
  }
}

// An ignored argument used to mean a full green run that looked like a filtered one. Never
// silently accept something we did not understand.
if (unknownArgs.length > 0) {
  console.error(`unknown argument(s): ${unknownArgs.join(" ")}`);
  console.error("usage: runner.mjs [--docs] [--headed] [--filter=<substring>]");
  process.exitCode = 1;
  process.exit();
}
if (filter === undefined && rawArgs.includes("--filter")) {
  console.error("--filter needs a value, e.g. --filter=parquet");
  process.exitCode = 1;
  process.exit();
}

const shotsDir = join(repoRoot, ".ui-verify", "shots");
const docsDir = join(repoRoot, "docs", "screenshots");

mkdirSync(shotsDir, { recursive: true });

import { expect, unexpected } from "./helpers.mjs";

import json from "./scenarios/json.mjs";
import jsonl from "./scenarios/jsonl.mjs";
import compare from "./scenarios/compare.mjs";
import parquetFrames from "./scenarios/parquet-frames.mjs";
import parquetMotion from "./scenarios/parquet-motion.mjs";
import parquetSurfaces from "./scenarios/parquet-surfaces.mjs";
import parquetBasics from "./scenarios/parquet-basics.mjs";
import parquetGrid from "./scenarios/parquet-grid.mjs";
import other from "./scenarios/other.mjs";

const scenarios = [
  ...json,
  ...jsonl,
  ...parquetBasics,
  ...parquetGrid,
  ...parquetSurfaces,
  ...parquetMotion,
  ...parquetFrames,
  ...compare,
  ...other,
];

async function main() {
  const fixtures = createFixtures(join(repoRoot, ".ui-verify"));
  const harness = await startHarness(fixtures);
  let browser;
  let failures = 0;
  const results = [];

  try {
    browser = await launchBrowser({ headless: !headed });
    const selected = scenarios.filter((scenario) => !filter || scenario.name.includes(filter));
    if (selected.length === 0) throw new Error(`no scenario matches --filter=${filter}`);

    for (const scenario of selected) {
      const started = Date.now();
      const context = {
        page: browser,
        base: harness.url,
        setReducedMotion: browser.setReducedMotion,
        frames: browser.frames,
        clearFrames: browser.clearFrames,
        stats: async () => (await fetch(`${harness.url}/stats`)).json(),
      };
      browser.clearViolations();
      try {
        const detail = await scenario.run(context);
        const violations = unexpected(browser.violations());
        expect(violations.length === 0, `CSP violation: ${violations[0] ?? ""}`);
        await browser.screenshot(join(shotsDir, `${scenario.name}.png`));
        if (refreshDocs && scenario.docs) {
          copyFileSync(join(shotsDir, `${scenario.name}.png`), join(docsDir, scenario.docs));
        }
        results.push({ name: scenario.name, ok: true, detail, ms: Date.now() - started });
      } catch (error) {
        // Page-level exceptions are the single most useful thing when a scenario times out,
        // and they were being collected but never reported.
        const pageErrors = unexpected(browser.exceptions()).slice(0, 2);
        const detail = pageErrors.length
          ? `${error.message} | page errors: ${pageErrors.join(" ; ")}`
          : error.message;
        results.push({
          name: scenario.name,
          ok: false,
          detail,
          ms: Date.now() - started,
        });
        failures++;
        // Keep the screen even when the scenario failed — a red run is exactly when the
        // screenshot is worth looking at.
        try {
          await browser.screenshot(join(shotsDir, `${scenario.name}.FAILED.png`));
        } catch {
          // a page that cannot be captured is part of the failure, not a new one
        }
      }
    }
  } finally {
    if (browser) await browser.close();
    await harness.close();
  }

  for (const result of results) {
    const mark = result.ok ? "PASS" : "FAIL";
    console.log(
      `${mark}  ${result.name.padEnd(38)} ${String(result.ms).padStart(5)}ms  ${result.detail}`,
    );
  }
  console.log(`\n${results.length - failures}/${results.length} scenarios passed`);

  // A summary *after* the count keeps the failing names in the tail of the output, and the
  // JSON file keeps the whole run when the terminal output is truncated or lost.
  if (failures > 0) {
    console.log("\nFailed:");
    for (const result of results) {
      if (!result.ok) console.log(`  ${result.name}: ${result.detail}`);
    }
  }
  try {
    mkdirSync(join(repoRoot, ".ui-verify"), { recursive: true });
    writeFileSync(
      join(repoRoot, ".ui-verify", "last-run.json"),
      `${JSON.stringify({ at: new Date().toISOString(), passed: results.length - failures, total: results.length, results }, null, 2)}\n`,
    );
  } catch {
    // reporting is a convenience; never turn a reporting failure into a red gate
  }

  // `process.exit()` would truncate piped stdout on Windows and could swallow the lines above.
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
