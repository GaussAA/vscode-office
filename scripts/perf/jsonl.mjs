/**
 * Host-side JSONL performance checks.
 *
 * The browser harness cannot see the extension host, where line indexing, window parsing and
 * the whole-file scan run. esbuild bundles those services into a temp directory and Node
 * measures them directly; the browser still runs for the parquet and spreadsheet scenarios.
 *
 * The window check asserts the **returned row count**, not only time: 40 x 2 MB lines must
 * return one row under the 4 MB budget, never the 40 an unbudgeted 500-line request parses.
 * The time budgets are loose and only catch an order of magnitude.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { repoRoot } from "../ui-verify/fixtures.mjs";
import { expect } from "./expect.mjs";

const MB = 1024 * 1024;
const JSONL_WINDOW_MAX_ROWS = 3;
const JSONL_WINDOW_BUDGET_MS = 1_500;
const JSONL_SEARCH_BUDGET_MS = 5_000;

/**
 * Bundle the host-side JSONL services for Node. The entry points preserve their relative
 * output paths (`service/jsonlFile.mjs`, `react/view/jsonl/jsonlFormat.mjs`).
 */
export async function loadJsonlHost() {
  const outdir = mkdtempSync(join(tmpdir(), "perf-jsonl-"));
  await build({
    entryPoints: [
      join(repoRoot, "src/service/jsonlFile.ts"),
      join(repoRoot, "src/service/jsonlSession.ts"),
      join(repoRoot, "src/react/view/jsonl/jsonlFormat.ts"),
    ],
    outdir,
    outExtension: { ".js": ".mjs" },
    bundle: true,
    format: "esm",
    platform: "node",
    tsconfig: join(repoRoot, "tsconfig.json"),
    logLevel: "silent",
  });
  const fileModule = await import(pathToFileURL(join(outdir, "service", "jsonlFile.mjs")).href);
  const sessionModule = await import(
    pathToFileURL(join(outdir, "service", "jsonlSession.mjs")).href
  );
  const formatModule = await import(
    pathToFileURL(join(outdir, "react", "view", "jsonl", "jsonlFormat.mjs")).href
  );
  return {
    ...fileModule,
    JsonlSession: sessionModule.JsonlSession,
    buildEntryModel: formatModule.buildEntryModel,
    cleanup: () => rmSync(outdir, { recursive: true, force: true }),
  };
}

export const jsonlScenarios = [
  {
    name: "jsonl-huge-line-window",
    async run({ fixtures, jsonlHost }) {
      const file = await jsonlHost.JsonlFile.open(
        await jsonlHost.fileByteSource(fixtures.jsonlHuge),
      );
      const session = new jsonlHost.JsonlSession(file);
      try {
        const windowStarted = performance.now();
        const range = await session.readRange(1, 0, 500, 0);
        const windowMs = Math.round(performance.now() - windowStarted);
        expect(range.entries.length > 0, "the JSONL directory window is empty");
        expect(
          range.entries.length <= JSONL_WINDOW_MAX_ROWS,
          `${range.entries.length} rows were parsed for a 4 MB budget; the byte cap is not applied`,
        );
        expect(
          windowMs <= JSONL_WINDOW_BUDGET_MS,
          `the byte-budgeted window took ${windowMs} ms (budget ${JSONL_WINDOW_BUDGET_MS} ms)`,
        );

        const entryStarted = performance.now();
        const payload = await session.readEntry(2, 0);
        const entryMs = Math.round(performance.now() - entryStarted);
        const entry = payload?.entry;
        expect(entry?.kind === "value", `the first 2 MB line is ${entry?.kind ?? "missing"}`);
        expect(entry?.textChars > 2_000_000, `detail text is ${entry?.textChars} chars`);
        const model = entry ? jsonlHost.buildEntryModel(entry.value) : null;
        expect(model && model.count > 0, "the detail tree model is empty");
        return (
          `${windowMs} ms / ${range.entries.length} rows for ` +
          `${(fixtures.jsonlHugeBytes / MB).toFixed(1)} MB, ${fixtures.jsonlHugeLines} lines; ` +
          `first entry ${entryMs} ms, ${entry?.textChars.toLocaleString()} chars`
        );
      } finally {
        file.close();
      }
    },
  },
  {
    name: "jsonl-search-one-pass",
    async run({ fixtures, jsonlHost }) {
      const file = await jsonlHost.JsonlFile.open(
        await jsonlHost.fileByteSource(fixtures.jsonlLog),
      );
      const session = new jsonlHost.JsonlSession(file);
      try {
        const started = performance.now();
        let batches = 0;
        let matches = 0;
        let scanned = 0;
        await new Promise((resolve, reject) => {
          session.search(11, fixtures.jsonlLogNeedle, {
            onBatch: (batch) => {
              batches++;
              matches = batch.matches;
              scanned = batch.scanned;
              if (batch.done) resolve();
            },
          });
          setTimeout(() => reject(new Error("the JSONL search did not finish")), 60_000).unref();
        });
        const ms = Math.round(performance.now() - started);
        expect(matches === 1, `expected one match, got ${matches}`);
        expect(
          scanned === fixtures.jsonlLogLines,
          `scanned ${scanned} of ${fixtures.jsonlLogLines} lines`,
        );
        expect(
          ms <= JSONL_SEARCH_BUDGET_MS,
          `searching ${fixtures.jsonlLogLines.toLocaleString()} JSONL lines took ${ms} ms ` +
            `(budget ${JSONL_SEARCH_BUDGET_MS} ms); check the per-turn window budget`,
        );
        return `${ms} ms for ${fixtures.jsonlLogLines.toLocaleString()} lines → ${matches} match in ${batches} batches`;
      } finally {
        file.close();
      }
    },
  },
];
