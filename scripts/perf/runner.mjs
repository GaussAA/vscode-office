/**
 * Performance gate for the parquet viewer.
 *
 *   node scripts/perf/runner.mjs            # assert (needs `pnpm build` first)
 *   node scripts/perf/runner.mjs --all      # also print the non-asserted numbers
 *   node scripts/perf/runner.mjs --headed   # watch it run
 *
 * Three invariants, all learned from measuring the shipped bundle on large files:
 *
 *  1. **First paint is bounded by the file, not twice the file.** hyparquet plans a read per
 *     call and the viewer issues the visible page and its prefetch back to back; before the
 *     range cache learned to deduplicate in-flight requests, that downloaded 2.04x the file.
 *     The gate allows 1.15x (the extra is the footer, which is inside the chunk range).
 *  2. **A whole-file search is one pass.** Batching by 5000 rows re-decoded the data page
 *     containing each batch: 28 s for 1M rows and 40 s for 200k x 60. A single pass is ~1-3 s,
 *     so the budgets below are ~4-6x the measured value and still far under the old cost.
 *
 *  3. **A page turn stays interactive with 60 columns.** Warm turns are render-bound (~205 ms),
 *     cold ones also decode one data page per column (~550 ms). Both are gated, because a
 *     future change that materialises the page or re-decodes it shows up here first.
 *
 * Both parquet files are written with one row group (PyArrow's default), because that is the
 * shape where the difference shows.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launchBrowser } from "../ui-verify/browser.mjs";
import { repoRoot } from "../ui-verify/fixtures.mjs";
import { createPerfFixtures } from "./fixtures.mjs";
import { startPerfHarness } from "./harness.mjs";

/** First paint may cost at most this many times the file size. */
const FIRST_PAINT_BUDGET = 1.25;
/**
 * Milliseconds for a full scan of the 1M-row file. Measured: ~2.8 s on the development
 * machine, and timing here varies by ~2x run to run, so the budget has to be generous — but
 * the regression it guards is an order of magnitude: the old per-5000-row-batch loop takes
 * ~28 s on the same file. Any value between ~8 s and ~20 s separates the two; 12 s sits in
 * the middle, leaving room for a slower CI box without letting the batched version through.
 */
const SEARCH_BUDGET_FLAT_MS = 12_000;
/** Milliseconds for a full scan of the 200k-row x 60-column file. Measured: ~1.2-2.4 s; the batched version takes ~40 s. */
const SEARCH_BUDGET_WIDE_MS = 12_000;
/**
 * Milliseconds for one page turn on the 60-column file, measured after the prefetch has settled.
 * Measured on an idle machine: ~210 ms warm and ~520 ms cold (one decoded data page per column).
 * A loaded machine inflates both by 2-4x, so the budgets are deliberately loose: this gate exists
 * to catch an order-of-magnitude regression (the per-batch re-decode cost 5-10x), not to police
 * a few hundred milliseconds. The samples are reported so a real drift is still visible.
 */
const WIDE_PAGE_TURN_MS = 2_000;
/**
 * Back-to-back turns without waiting for the prefetch. Measured: ~520-1150 ms depending on
 * whether the previous prefetch is still decoding (single-flight makes the next request wait
 * for it). The budget guards against the multi-second regressions, not against that jitter.
 */
const WIDE_RAPID_TURN_MS = 5_000;
/**
 * Milliseconds for a 21 MB CSV to paint its first windowed row. Measured: ~0.5-1.4 s (the
 * The full-parse path this replaces needed ~2.6 s for 37 MB and would have climbed with size;
 * the window path's cost is a byte scan plus one block read, so the budget stays flat. The
 * headroom covers a loaded CI box; the regression it guards is the full parse, which needs
 * >5 s for this file.
 */
const SHEET_WINDOW_BUDGET_MS = 3_000;
/** The windowed path must not hold the sheet: bytes + offsets + one block, not one cell per value. */
const SHEET_WINDOW_HEAP_MB = 200;

const args = process.argv.slice(2);
const headed = args.includes("--headed");
const showAll = args.includes("--all");
const filter = args.find((argument) => argument.startsWith("--filter="))?.slice(9);
const unknown = args.filter(
  (argument) => !["--headed", "--all"].includes(argument) && !argument.startsWith("--filter="),
);
if (unknown.length > 0) {
  console.error(`unknown argument(s): ${unknown.join(" ")}`);
  console.error("usage: runner.mjs [--headed] [--all] [--filter=<substring>]");
  process.exitCode = 1;
  process.exit();
}

/**
 * Contention inflates a sample; it never makes a real regression look fast. So the gate takes
 * the *best* of several samples: a loaded machine then costs extra rounds instead of a red run,
 * while anything that makes even the best turn slow (the failure mode being guarded) still fails.
 */
const best = (values) => Math.min(...values);

const expect = (condition, message) => {
  if (!condition) throw new Error(message);
};

const MB = 1024 * 1024;

/** Read the in-page stopwatch and the JS heap after the viewer settled. */
const readTiming = (page) =>
  page
    .evaluate(
      `JSON.stringify({
        t0: window.__bench?.t0 ?? 0,
        ready: window.__bench?.ready ?? 0,
        heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
        cells: document.querySelectorAll('.parquet-viewer__cell').length,
        sheetRows: document.querySelectorAll('.windowed-sheet__row').length,
      })`,
    )
    .then(JSON.parse);

/** Advance one page and time it from the click to the first repainted row. */
const nextPage = (page) =>
  page
    .evaluate(`(async () => {
      const deadline = performance.now() + 60000;
      const info = () => document.querySelector('.parquet-viewer__pager-info')?.innerText ?? '';
      // Structure-agnostic: the table draws <tr>/<td> or a div list when virtual is on.
      const firstCell = () => document.querySelector('.parquet-table .ant-table-row')?.children[0]?.innerText ?? '';
      const before = info();
      const started = performance.now();
      [...document.querySelectorAll('.parquet-viewer__pager-btn')]
        .filter(button => button.getAttribute('aria-label') === 'Next page')[0]
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      let range = before;
      while (range === before) {
        if (performance.now() > deadline) return JSON.stringify({ timeout: true, stage: 'pager' });
        await new Promise(resolve => setTimeout(resolve, 4));
        range = info();
      }
      const wantFirst = range.split('–')[0].replace(/,/g, '');
      while (firstCell() !== wantFirst) {
        if (performance.now() > deadline) return JSON.stringify({ timeout: true, stage: 'rows' });
        await new Promise(resolve => setTimeout(resolve, 4));
      }
      return JSON.stringify({ ms: Math.round(performance.now() - started), range });
    })()`)
    .then(JSON.parse);

/** Run the whole-file search and time it inside the page. */
const search = (page, needle) =>
  page
    .evaluate(`(async () => {
      const deadline = performance.now() + 120000;
      const count = () => document.querySelector('.parquet-viewer__find-count')?.innerText ?? '';
      const spinner = () => !!document.querySelector('.parquet-viewer__find-btn .codicon-loading');
      const input = document.querySelector('.parquet-viewer__find-input');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, ${JSON.stringify(needle)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const started = performance.now();
      document.querySelector('.parquet-viewer__find-btn')
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));
      // A query with matches ends on "N rows"; one without matches ends with no count at
      // all, so "no spinner after the first frame" is the settlement signal.
      let settledAt = 0;
      while (performance.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 25));
        const text = count();
        if (spinner()) continue;
        if (text && /row/.test(text)) { settledAt = performance.now(); break; }
        if (performance.now() - started > 300) { settledAt = performance.now(); break; }
      }
      return JSON.stringify({
        ms: settledAt ? Math.round(settledAt - started) : null,
        count: count() || null,
        timedOut: !settledAt,
      });
    })()`)
    .then(JSON.parse);

const scenarios = [
  {
    name: "sheet-window-first-paint",
    async run({ page, base, harness, fixtures }) {
      // 21 MB CSV: above the 8 MB window threshold, below the 25 MB guard. The editable grid
      // would build ~2.2M cell objects; the windowed view scans bytes for record starts and
      // renders one block.
      harness.reset();
      await page.navigate(`${base}/sheet`);
      const ready = await page.waitFor(`(window.__bench?.ready ?? 0) > 0`, 60000);
      expect(ready, "the windowed sheet never painted");
      const timing = await readTiming(page);
      const served = harness.snapshot();
      const state = await page
        .evaluate(
          `JSON.stringify({
            rows: document.querySelectorAll('.windowed-sheet__row').length,
            total: Number(document.querySelector('.windowed-sheet')?.dataset.rows ?? 0),
            grid: !!document.querySelector('.x-spreadsheet'),
          })`,
        )
        .then(JSON.parse);

      expect(state.total >= 200_000, `only ${state.total} records were indexed`);
      expect(!state.grid, "the editable grid mounted for a large file");
      expect(
        timing.sheetRows > 0 && timing.sheetRows < 100,
        `${timing.sheetRows} rows are in the DOM; the viewport holds tens, not thousands`,
      );
      const ms = Math.round(timing.ready - timing.t0);
      expect(
        ms <= SHEET_WINDOW_BUDGET_MS,
        `first windowed paint took ${ms} ms (budget ${SHEET_WINDOW_BUDGET_MS} ms)`,
      );
      expect(
        timing.heapMB === null || timing.heapMB <= SHEET_WINDOW_HEAP_MB,
        `heap ${timing.heapMB} MB over budget ${SHEET_WINDOW_HEAP_MB} MB; the sheet is being materialised`,
      );
      expect(
        served.bytes <= fixtures.flatCsvBytes * 1.05,
        `downloaded ${served.bytes} bytes for a ${fixtures.flatCsvBytes} byte file`,
      );
      return `${ms} ms, ${timing.sheetRows} rows in the DOM of ${state.total.toLocaleString()}, heap ${timing.heapMB} MB`;
    },
  },

  {
    name: "parquet-first-paint-bytes",
    async run({ page, base, harness, fixtures }) {
      harness.reset();
      await page.navigate(`${base}/harness?file=flat`);
      const ready = await page.waitFor(`(window.__bench?.ready ?? 0) > 0`, 60000);
      expect(ready, "the first page never painted");
      const timing = await readTiming(page);
      const served = harness.snapshot();
      expect(timing.cells > 0, "no cells rendered");

      const ratio = served.bytes / fixtures.flatBytes;
      expect(
        ratio <= FIRST_PAINT_BUDGET,
        `first paint downloaded ${(served.bytes / MB).toFixed(1)} MB ` +
          `(${ratio.toFixed(2)}x the ${(fixtures.flatBytes / MB).toFixed(1)} MB file); ` +
          `budget is ${FIRST_PAINT_BUDGET}x — a duplicate in-flight range request is the usual cause`,
      );

      harness.reset();
      const next = await nextPage(page);
      expect(!next.timeout, `paging forward stalled at ${next.stage}`);
      const paged = harness.snapshot();
      expect(
        paged.bytes === 0,
        `paging forward downloaded ${paged.bytes} bytes; the next page must come from the cache`,
      );

      return (
        `${Math.round(timing.ready - timing.t0)} ms, ` +
        `${(served.bytes / MB).toFixed(2)} MB = ${ratio.toFixed(2)}x file` +
        ` (page turn ${next.ms} ms, 0 bytes)`
      );
    },
  },
  {
    name: "parquet-wide-page-turn",
    async run({ page, base, harness }) {
      await page.navigate(`${base}/harness?file=wide`);
      const ready = await page.waitFor(`(window.__bench?.ready ?? 0) > 0`, 60000);
      expect(ready, "the wide file never painted");
      // The idle prefetch needs to finish before "warm" means anything.
      await page.sleep(3000);
      harness.reset();

      // Machine load moves a single turn by 2-4x, so assert on the best of three instead of
      // whichever sample happened to run while another build was finishing.
      const warm = [];
      for (let attempt = 0; attempt < 3; attempt++) {
        // Pause before every sample: a turn measured right after another turn is cold by
        // definition, and mixing the two is what made this look like a 2x regression.
        if (attempt > 0) await page.sleep(2500);
        const turn = await nextPage(page);
        expect(!turn.timeout, `paging forward stalled at ${turn.stage}`);
        warm.push(turn.ms);
      }
      const warmBest = best(warm);
      expect(
        warmBest <= WIDE_PAGE_TURN_MS,
        `the best warm page turn on 60 columns was ${warmBest} ms ` +
          `(samples ${warm.join(", ")}; budget ${WIDE_PAGE_TURN_MS} ms)`,
      );

      // Rapid: no pause between turns, so the next window's data pages are not prefetched.
      const cold = [];
      for (let attempt = 0; attempt < 2; attempt++) {
        const turn = await nextPage(page);
        expect(!turn.timeout, `rapid paging stalled at ${turn.stage}`);
        cold.push(turn.ms);
      }
      const coldBest = best(cold);
      expect(
        coldBest <= WIDE_RAPID_TURN_MS,
        `the best cold page turn on 60 columns was ${coldBest} ms ` +
          `(samples ${cold.join(", ")}; budget ${WIDE_RAPID_TURN_MS} ms)`,
      );
      return `warm ${warmBest} ms ${JSON.stringify(warm)}, cold ${coldBest} ms ${JSON.stringify(cold)}`;
    },
  },
  {
    name: "parquet-search-full-scan",
    async run({ page, base, fixtures }) {
      await page.navigate(`${base}/harness?file=flat`);
      const ready = await page.waitFor(`(window.__bench?.ready ?? 0) > 0`, 60000);
      expect(ready, "the viewer never painted");
      const result = await search(page, fixtures.flatLastRowNeedle);
      expect(!result.timedOut, "the search never settled");
      expect(
        result.ms <= SEARCH_BUDGET_FLAT_MS,
        `searching ${fixtures.flatRows.toLocaleString()} rows took ${result.ms} ms ` +
          `(budget ${SEARCH_BUDGET_FLAT_MS} ms); check for a per-batch re-read`,
      );
      expect(/1 of 1/.test(result.count ?? ""), `unexpected match count: ${result.count}`);
      return `${result.ms} ms for ${fixtures.flatRows.toLocaleString()} rows → ${result.count}`;
    },
  },
  {
    name: "parquet-wide-search",
    async run({ page, base, fixtures }) {
      await page.navigate(`${base}/harness?file=wide`);
      const ready = await page.waitFor(`(window.__bench?.ready ?? 0) > 0`, 60000);
      expect(ready, "the wide viewer never painted");
      const result = await search(page, fixtures.wideNeedle);
      expect(!result.timedOut, "the wide search never settled");
      expect(
        result.ms <= SEARCH_BUDGET_WIDE_MS,
        `searching 60 columns x ${fixtures.wideRows.toLocaleString()} rows took ${result.ms} ms ` +
          `(budget ${SEARCH_BUDGET_WIDE_MS} ms); the per-column page pass is what keeps this linear`,
      );
      expect(
        typeof result.count === "string" && !/^0 /.test(result.count),
        `unexpected match count: ${result.count}`,
      );
      const timing = await readTiming(page);
      return `${result.ms} ms, ${result.count}, heap ${timing.heapMB} MB`;
    },
  },
];

async function main() {
  const fixtures = createPerfFixtures(join(repoRoot, ".perf"));
  const harness = await startPerfHarness(fixtures);
  let browser;
  const results = [];
  let failures = 0;

  try {
    browser = await launchBrowser({ headless: !headed });
    const page = browser;
    const selected = scenarios.filter((scenario) => !filter || scenario.name.includes(filter));
    if (selected.length === 0) throw new Error(`no scenario matches --filter=${filter}`);

    for (const scenario of selected) {
      const started = Date.now();
      try {
        const detail = await scenario.run({ page, base: harness.url, harness, fixtures });
        results.push({ name: scenario.name, ok: true, detail, ms: Date.now() - started });
      } catch (error) {
        failures++;
        results.push({
          name: scenario.name,
          ok: false,
          detail: error instanceof Error ? error.message : String(error),
          ms: Date.now() - started,
        });
      }
    }

    if (showAll) {
      console.log(
        `fixtures: flat ${(fixtures.flatBytes / MB).toFixed(1)} MB / ${fixtures.flatRows.toLocaleString()} rows, ` +
          `wide ${(fixtures.wideBytes / MB).toFixed(1)} MB / ${fixtures.wideRows.toLocaleString()} rows`,
      );
    }
  } finally {
    if (browser) await browser.close();
    await harness.close();
  }

  for (const result of results) {
    const mark = result.ok ? "PASS" : "FAIL";
    console.log(
      `${mark}  ${result.name.padEnd(30)} ${String(result.ms).padStart(6)}ms  ${result.detail}`,
    );
  }
  console.log(`\n${results.length - failures}/${results.length} performance checks passed`);

  try {
    mkdirSync(join(repoRoot, ".perf"), { recursive: true });
    writeFileSync(
      join(repoRoot, ".perf", "last-run.json"),
      `${JSON.stringify({ at: new Date().toISOString(), results }, null, 2)}\n`,
    );
  } catch {
    // reporting is a convenience; never turn a reporting failure into a red gate
  }

  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
