/**
 * Host-side JSON preview performance checks.
 *
 * The 100 MiB array must be indexed without a whole-document JSON.parse, a record window must
 * parse only the records it returns, and a whole-file search is one lowercased pass. esbuild
 * bundles the service for Node; the browser does not participate.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { repoRoot } from "../ui-verify/fixtures.mjs";
import { expect } from "./expect.mjs";

const MB = 1024 * 1024;
const JSON_INDEX_BUDGET_MS = 6_000;
const JSON_WINDOW_BUDGET_MS = 2_000;
const JSON_SEARCH_BUDGET_MS = 8_000;

export async function loadJsonHost() {
  const outdir = mkdtempSync(join(tmpdir(), "perf-json-"));
  await build({
    entryPoints: [join(repoRoot, "src/service/jsonPreview.ts")],
    outdir,
    outExtension: { ".js": ".mjs" },
    bundle: true,
    format: "esm",
    platform: "node",
    tsconfig: join(repoRoot, "tsconfig.json"),
    logLevel: "silent",
  });
  const module = await import(pathToFileURL(join(outdir, "jsonPreview.mjs")).href);
  return {
    JsonPreviewSession: module.JsonPreviewSession,
    cleanup: () => rmSync(outdir, { recursive: true, force: true }),
  };
}

export const jsonScenarios = [
  {
    name: "json-array-index-window-search",
    async run({ fixtures, jsonHost }) {
      const text = readFileSync(fixtures.jsonArray, "utf8");
      expect(
        Buffer.byteLength(text, "utf8") <= 100 * MB,
        `the fixture is ${(Buffer.byteLength(text, "utf8") / MB).toFixed(1)} MB, over the preview cap`,
      );

      const indexStarted = performance.now();
      const session = new jsonHost.JsonPreviewSession(
        text,
        Buffer.byteLength(text, "utf8"),
        "array.json",
        "perf:json",
        false,
      );
      const indexMs = Math.round(performance.now() - indexStarted);
      expect(session.info.rootKind === "array", `root is ${session.info.rootKind}`);
      expect(
        session.info.recordCount === fixtures.jsonArrayRecords,
        `indexed ${session.info.recordCount} of ${fixtures.jsonArrayRecords} records`,
      );
      expect(
        indexMs <= JSON_INDEX_BUDGET_MS,
        `indexing ${(fixtures.jsonArrayBytes / MB).toFixed(1)} MB took ${indexMs} ms ` +
          `(budget ${JSON_INDEX_BUDGET_MS} ms); the top-level array is being parsed whole`,
      );

      const windowStarted = performance.now();
      const window = session.recordsInWindow(0, 100);
      const windowMs = Math.round(performance.now() - windowStarted);
      expect(window.length === 100, `window returned ${window.length} summaries`);
      expect(window[0]?.label !== undefined, "the first record has no identity label");
      expect(
        windowMs <= JSON_WINDOW_BUDGET_MS,
        `parsing a 100-record window took ${windowMs} ms (budget ${JSON_WINDOW_BUDGET_MS} ms)`,
      );

      const detailStarted = performance.now();
      const detail = session.record(0);
      const detailMs = Math.round(performance.now() - detailStarted);
      expect(detail?.kind === "value", `record 0 is ${detail?.kind ?? "missing"}`);

      const searchStarted = performance.now();
      let matches = 0;
      let lastIndex = -1;
      let scanned = 0;
      await new Promise((resolve, reject) => {
        session.search(9, fixtures.jsonArrayNeedle, {
          onBatch: (batch) => {
            matches = batch.matches;
            scanned = batch.scanned;
            lastIndex = batch.records.at(-1)?.index ?? lastIndex;
            if (batch.done) resolve();
          },
        });
        setTimeout(() => reject(new Error("the JSON search did not finish")), 60_000).unref();
      });
      const searchMs = Math.round(performance.now() - searchStarted);
      expect(matches === 1, `expected one match, got ${matches}`);
      expect(
        lastIndex === fixtures.jsonArrayRecords - 1,
        `the only match is in record ${lastIndex}, not the last record`,
      );
      expect(scanned === text.length, `scanned ${scanned} of ${text.length} characters`);
      expect(
        searchMs <= JSON_SEARCH_BUDGET_MS,
        `searching ${(fixtures.jsonArrayBytes / MB).toFixed(1)} MB took ${searchMs} ms ` +
          `(budget ${JSON_SEARCH_BUDGET_MS} ms); check for a per-record re-scan`,
      );

      return (
        `${indexMs} ms index / ${windowMs} ms window / ${detailMs} ms detail / ` +
        `${searchMs} ms search for ${(fixtures.jsonArrayBytes / MB).toFixed(1)} MB, ` +
        `${session.info.recordCount.toLocaleString()} records`
      );
    },
  },
];
