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

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

const json = (value) => JSON.parse(value);

/**
 * The one expected CSP refusal, filtered on both channels the browser can report it on.
 *
 * epubjs ships a `globalThis` polyfill that probes with `new Function("return this")`; our
 * policy has no `'unsafe-eval'`, so the probe is refused — inside a try/catch, and it falls
 * back to `window`. Chrome surfaces the refusal as an uncaught `EvalError` *and* as a console
 * error, depending on the driver, so a single predicate covers `exceptions()` and
 * `violations()`. Everything else stays fatal: allow-listing this one reason is strictly
 * better than weakening the policy for every viewer, which the probe does not need.
 */
const expectedProbe = /evaluating a string as JavaScript/i;
const unexpected = (list) => list.filter((text) => !expectedProbe.test(text));

async function openJsonl(page, base, theme = "dark") {
  await page.navigate(`${base}/harness?theme=${theme}`);
  const ready = await page.waitFor(
    `!!document.querySelector('.jsonl-index__tree .ant-tree-treenode')`,
  );
  expect(ready, "JSONL directory did not render");
}

async function jumpJsonl(page, entry) {
  await page.evaluate(`(() => {
        const input = document.querySelector('.jsonl-jump input');
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        input.focus();
        setter.call(input, ${JSON.stringify(String(entry))});
        input.dispatchEvent(new Event('input', { bubbles: true }));
        const go = [...document.querySelectorAll('.jsonl-toolbar button')].find(b => b.textContent.trim() === 'Go');
        go.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    })()`);
  // The header flips to the new line as soon as the request is issued; the body is what the
  // scenarios assert on, so wait for it too.
  const loaded = await page.waitFor(`(() => {
        if (document.querySelector('.jsonl-detail__index')?.innerText.trim() !== ${JSON.stringify(`L${entry}`)}) return false;
        return !!document.querySelector('.jsonl-detail__tree, .jsonl-detail__scalar, .jsonl-detail__raw');
    })()`);
  expect(loaded, `entry L${entry} never finished rendering`);
}

async function openParquet(page, base, query = "") {
  // The viewer remembers the page a document was left on (localStorage, keyed by path).
  // Scenarios share one browser profile, so without this a scenario that ends on page 2
  // would leave the next one unable to find row 1. Start every scenario from a clean slate;
  // `parquet-restore-page` proves the restoring half deliberately.
  await page.navigate(`${base}/stats`);
  await page.evaluate(`Object.keys(localStorage)
        .filter(key => key.startsWith('parquet-state:'))
        .forEach(key => localStorage.removeItem(key))`);
  await page.navigate(`${base}/harness-parquet${query}`);
  // antd renders a No data row before the first page arrives, so wait for a real cell
  const ready = await page.waitFor(`!!document.querySelector('.parquet-viewer__cell')`);
  expect(ready, "parquet table did not render");
}

const pagerState = (page) =>
  page
    .evaluate(`JSON.stringify({
    range: document.querySelector('.parquet-viewer__pager-info')?.innerText ?? null,
    first: document.querySelector('.parquet-table tbody tr:nth-child(2) td')?.innerText ?? null,
    banner: document.querySelector('.parquet-viewer__readonly-banner')?.innerText ?? null,
})`)
    .then(json);

/** Perceived luminance (0..1) of an element's background, or null when it has none. */
const luminance = (page, selector) =>
  page.evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return null;
    const colour = getComputedStyle(element).backgroundColor || '';
    const match = colour.match(/rgba?\\(\\s*([\\d.]+)\\s*,\\s*([\\d.]+)\\s*,\\s*([\\d.]+)(?:\\s*,\\s*([\\d.]+))?/i);
    if (!match) return null;
    const alpha = match[4] === undefined ? 1 : Number(match[4]);
    if (alpha < 0.5) return null;
    return (0.299 * Number(match[1]) + 0.587 * Number(match[2]) + 0.114 * Number(match[3])) / 255;
})()`);

async function clickNextPage(page) {
  const before = (await pagerState(page)).range;
  await page.evaluate(`[...document.querySelectorAll('.parquet-viewer__pager-btn')]
        .filter(b => b.getAttribute('aria-label') === 'Next page')[0]
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
  const moved = await page.waitFor(
    `(document.querySelector('.parquet-viewer__pager-info')?.innerText ?? '') !== ${JSON.stringify(before)}`,
  );
  expect(moved, `pager stayed on ${before}`);
}

const scenarios = [
  {
    name: "jsonl-directory",
    docs: "jsonl-two-pane.png",
    async run({ page, base }) {
      await openJsonl(page, base);
      const state = json(
        await page.evaluate(`JSON.stringify({
                file: document.querySelector('.jsonl-file-name')?.innerText ?? null,
                meta: document.querySelector('.jsonl-meta')?.innerText ?? null,
                index: document.querySelector('.jsonl-detail__index')?.innerText ?? null,
                rows: document.querySelectorAll('.jsonl-index__tree .ant-tree-treenode').length,
            })`),
      );
      expect(state.file === "events.jsonl", `unexpected file name: ${state.file}`);
      expect(state.rows >= 10, `directory rendered ${state.rows} rows`);
      expect(state.index === "L1", `unexpected first selection: ${state.index}`);
      expect(/entries/.test(state.meta ?? ""), `missing entry count: ${state.meta}`);
      return `${state.rows} rows, ${state.meta}`;
    },
  },
  {
    name: "jsonl-wrap-long-value",
    docs: "jsonl-wrap.png",
    async run({ page, base }) {
      await openJsonl(page, base);
      await jumpJsonl(page, 13);
      const state = json(
        await page.evaluate(`JSON.stringify((() => {
                const wrap = [...document.querySelectorAll('.jsonl-val--wrap')].find(n => n.textContent.length > 100);
                return {
                    scroll: !!document.querySelector('.jsonl-detail__scroll'),
                    count: document.querySelectorAll('.jsonl-val--wrap').length,
                    height: wrap ? Math.round(wrap.getBoundingClientRect().height) : 0,
                };
            })())`),
      );
      expect(state.scroll, "wrap mode did not switch off virtual scrolling");
      expect(state.count > 0, "no wrapped values rendered");
      expect(state.height > 30, `wrapped value is only ${state.height}px tall`);
      return `${state.count} wrapped values, tallest ${state.height}px`;
    },
  },
  {
    name: "jsonl-big-entry-stays-single-line",
    async run({ page, base }) {
      await openJsonl(page, base);
      await jumpJsonl(page, 14);
      const state = json(
        await page.evaluate(`JSON.stringify({
                scroll: !!document.querySelector('.jsonl-detail__scroll'),
                count: document.querySelectorAll('.jsonl-val--wrap').length,
                tree: !!document.querySelector('.jsonl-detail__tree'),
            })`),
      );
      expect(state.tree, "big entry rendered no tree");
      expect(!state.scroll, "600-key entry wrongly enabled wrapping");
      expect(state.count === 0, `600-key entry produced ${state.count} wrapped values`);
      return "virtual single-line mode";
    },
  },
  {
    name: "jsonl-search",
    docs: "jsonl-search.png",
    async run({ page, base }) {
      await openJsonl(page, base);
      await page.evaluate(`(() => {
                const input = document.querySelector('.jsonl-search input');
                const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                input.focus();
                setter.call(input, 'id');
                input.dispatchEvent(new Event('input', { bubbles: true }));
            })()`);
      const sawBanner = await page.waitFor(`!!document.querySelector('.jsonl-index__banner')`);
      expect(sawBanner, "search banner never appeared");
      const sawHits = await page.waitFor(`document.querySelectorAll('.jsonl-hit').length > 0`);
      expect(sawHits, "no match highlighting rendered");
      // Settled means: a match count, and no longer "Searching…".
      const settled = await page.waitFor(`(() => {
                const text = document.querySelector('.jsonl-index__banner')?.innerText ?? '';
                return /\\d+ match/.test(text) && !text.includes('Searching');
            })()`);
      expect(settled, "search banner never settled on a match count");
      const state = json(
        await page.evaluate(`JSON.stringify({
                banner: document.querySelector('.jsonl-index__banner')?.innerText ?? null,
                hits: document.querySelectorAll('.jsonl-hit').length,
            })`),
      );
      expect(/(\d+) match/.test(state.banner ?? ""), `unexpected banner: ${state.banner}`);
      expect(state.hits > 0, "no match highlighting rendered");
      return `${state.banner}, ${state.hits} highlighted runs`;
    },
  },
  {
    name: "parquet-paging",
    docs: "parquet-types.png",
    async run({ page, base }) {
      await openParquet(page, base, "?mixed=1");
      const first = await pagerState(page);
      expect(first.range === "1–50 of 300", `page 1 range: ${first.range}`);
      expect(first.first === "1", `page 1 first row: ${first.first}`);
      await clickNextPage(page);
      const second = await pagerState(page);
      expect(second.range === "51–100 of 300", `page 2 range: ${second.range}`);
      expect(second.first === "51", `page 2 first row: ${second.first}`);
      return `1–50 then 51–100 of 300`;
    },
  },
  {
    name: "parquet-restore-page",
    docs: "parquet-restore-page.png",
    async run({ page, base }) {
      await openParquet(page, base, "?mixed=1");
      await clickNextPage(page);
      const second = await pagerState(page);
      expect(second.range === "51–100 of 300", `page 2 range: ${second.range}`);

      // A fresh document with the same localStorage: exactly what a tab switch does once
      // the webview is allowed to be destroyed while kept hidden. Wait for the rows too:
      // the pager text updates before the page's cells arrive, so asserting on the range
      // alone races the table (this started failing on antd 6, whose render order differs).
      await page.navigate(`${base}/harness-parquet?mixed=1`);
      const restored = await page.waitFor(
        `document.querySelector('.parquet-viewer__pager-info')?.innerText === '51–100 of 300'` +
          ` && document.querySelector('.parquet-table tbody tr:nth-child(2) td')?.innerText === '51'`,
        15000,
      );
      const after = await pagerState(page);
      expect(
        restored,
        `page was not restored with its rows, got ${after.range} / row ${after.first}`,
      );
      return `reloaded onto ${after.range}`;
    },
  },
  {
    name: "parquet-large-readonly",
    docs: "parquet-large-file.png",
    async run({ page, base }) {
      await openParquet(page, base, "?big=1");
      const state = await pagerState(page);
      expect(/Read-only/.test(state.banner ?? ""), `missing read-only banner: ${state.banner}`);
      expect(state.range === "1–50 of 250,000", `large range: ${state.range}`);
      await page.evaluate(`(() => {
                const input = document.querySelector('.parquet-viewer__row-jump');
                const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                setter.call(input, '240000');
                input.dispatchEvent(new Event('input', { bubbles: true }));
                [...document.querySelectorAll('.parquet-viewer__pager-btn')]
                    .find(b => b.textContent.trim() === 'Go')
                    ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            })()`);
      const arrived = await page.waitFor(
        `(document.querySelector('.parquet-viewer__pager-info')?.innerText ?? '').includes('239,951')`,
      );
      expect(arrived, "jump never reached row 239,951");
      const jumped = await pagerState(page);
      expect(jumped.range === "239,951–240,000 of 250,000", `jump range: ${jumped.range}`);
      expect(jumped.first === "239951", `jump first row: ${jumped.first}`);
      return "read-only + jump to row 240,000";
    },
  },
  {
    name: "parquet-theme-follows-vscode",
    docs: "parquet-light.png",
    async run({ page, base }) {
      // Dark: antd widgets used to stay light even under a dark view, which put a white
      // "row" box on a black toolbar.
      await openParquet(page, base, "?mixed=1&theme=dark");
      const darkRow = await luminance(page, ".parquet-viewer__row-jump");
      expect(
        darkRow !== null && darkRow < 0.5,
        `row input stayed light in a dark theme (luminance ${darkRow})`,
      );

      // Light: a native input used to keep the dark VS Code var while the page went light.
      await openParquet(page, base, "?mixed=1&theme=light");
      const lightFind = await luminance(page, ".parquet-viewer__find-input");
      const lightRow = await luminance(page, ".parquet-viewer__row-jump");
      expect(
        lightFind !== null && lightFind > 0.5,
        `find input stayed dark in a light theme (luminance ${lightFind})`,
      );
      expect(
        lightRow !== null && lightRow > 0.5,
        `row input stayed dark in a light theme (luminance ${lightRow})`,
      );
      return "antd + native inputs follow the VS Code theme";
    },
  },
  {
    name: "parquet-inspector",
    docs: "parquet-inspector.png",
    async run({ page, base }) {
      await openParquet(page, base, "?mixed=1");
      await page.evaluate(`(() => {
                const cell = document.querySelector('.parquet-table tbody tr:nth-child(2) td:nth-child(3) .parquet-viewer__cell');
                cell.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            })()`);
      const inspected = await page.waitFor(
        `/name · row 1/.test(document.querySelector('.parquet-viewer__inspector-label')?.innerText ?? '')`,
      );
      expect(inspected, "inspector never showed name · row 1");
      const state = json(
        await page.evaluate(`JSON.stringify({
                label: document.querySelector('.parquet-viewer__inspector-label')?.innerText ?? null,
                value: document.querySelector('.parquet-viewer__inspector-value')?.innerText ?? null,
            })`),
      );
      expect(/name · row 1/.test(state.label ?? ""), `unexpected inspector label: ${state.label}`);
      expect((state.value ?? "").length > 0, "inspector showed no value");
      await clickNextPage(page);
      const cleared = await page.evaluate(`!document.querySelector('.parquet-viewer__inspector')`);
      expect(cleared, "inspector survived a page change");
      return `${state.label} = ${state.value}`;
    },
  },
  {
    name: "parquet-search",
    docs: "parquet-search.png",
    async run({ page, base }) {
      await openParquet(page, base, "?mixed=1");
      await page.evaluate(`(() => {
                const input = document.querySelector('.parquet-viewer__find-input');
                const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                setter.call(input, 'service-c-54');
                input.dispatchEvent(new Event('input', { bubbles: true }));
                document.querySelector('.parquet-viewer__find-btn')
                    .dispatchEvent(new MouseEvent('click', { bubbles: true }));
            })()`);
      const done = await page.waitFor(
        `document.querySelector('.parquet-viewer__find-count')?.innerText === '1 row'`,
        15000,
      );
      expect(done, "whole-file search did not report a match");
      const state = json(
        await page.evaluate(`JSON.stringify({
                count: document.querySelector('.parquet-viewer__find-count')?.innerText ?? null,
                hits: document.querySelectorAll('.parquet-viewer__hit').length,
                rows: document.querySelectorAll('.parquet-viewer__row--match').length,
                range: document.querySelector('.parquet-viewer__pager-info')?.innerText ?? null,
            })`),
      );
      expect(state.count === "1 row", `unexpected match count: ${state.count}`);
      expect(state.hits > 0, "matched cell was not highlighted");
      expect(state.rows === 1, `expected 1 marked row, got ${state.rows}`);
      expect(state.range === "51–100 of 300", `did not jump to the match page: ${state.range}`);
      return `${state.count} at ${state.range}, ${state.hits} highlighted cell(s)`;
    },
  },
  {
    name: "markdown-editor",
    async run({ page, base }) {
      // The one viewer that is not a React route: `resource/markdown/index.html` plus the
      // prebuilt vditor bundle. Nothing else covers it, so a change to how the host feeds it
      // (which messages, which options, which context-menu items) had no gate at all.
      await page.navigate(`${base}/resource/markdown/index.html`);
      await page.evaluate(`(() => {
        window.postMessage({
          type: 'open',
          content: {
            content: '# Probe heading\\n\\nA paragraph with **bold** text.\\n',
            rootPath: '/resource/markdown',
            workspaceBaseUrl: '',
            documentCacheId: 'probe',
            shouldRestoreFocus: false,
            fileName: 'probe.md',
            config: {
              language: 'en',
              markdown: { math: { macros: {} } },
              editMode: 'wysiwyg',
              editorTheme: 'Auto',
              codeMirrorTheme: 'Auto',
              mermaidTheme: 'Auto',
              preventMacOptionKey: false,
            },
          },
        }, '*');
      })()`);

      const mounted = await page.waitFor(`!!document.querySelector('#vditor.vditor')`, 20000);
      expect(mounted, "the editor never mounted");
      const rendered = await page.waitFor(
        `document.body.innerText.includes('Probe heading')`,
        15000,
      );
      expect(rendered, "the probe markdown never rendered");
      const aiEntry = await page.evaluate(`!!document.querySelector('[data-action="aiPolish"]')`);
      expect(!aiEntry, "the removed AI Polish menu item is back");
      return "vditor mounted, probe heading rendered, no AI entry";
    },
  },
  {
    name: "upstream-viewers-smoke",
    async run({ page, base }) {
      // React routes only: html/pdf are provider-served static pages and markdown has its own editor bundle.
      const routes = [
        "image",
        "svg",
        "excel",
        "zip",
        "word",
        "ppt",
        "font",
        "epub",
        "icns",
        "psd",
        "xmind",
        "gitHistory",
      ];
      const failures = [];
      for (const route of routes) {
        page.clearExceptions();
        await page.navigate(`${base}/harness-route?route=${route}`);
        // Poll instead of sleeping: the excel/epub chunks are ~1 MB and mount slower on
        // a loaded machine than any fixed delay we would pick (this used to flake).
        const mounted = await page.waitFor(
          `!!document.querySelector('#root')?.children.length`,
          6000,
        );
        const errors = unexpected(page.exceptions());
        if (!mounted) failures.push(`${route}: nothing mounted`);
        if (errors.length) failures.push(`${route}: ${errors[0].split("\n")[0]}`);
      }
      expect(failures.length === 0, failures.join(" | "));
      return `${routes.length} routes mounted without uncaught errors`;
    },
  },
  {
    name: "word-viewer",
    docs: "word-viewer.png",
    async run({ page, base }) {
      await page.navigate(`${base}/harness-route?route=word`);
      // "something is in #root" would accept the loading spinner, and the upstream smoke
      // cannot tell a rendered document from a failed open. Require both the editor's own
      // DOM and the paragraph text from the fixture (`scripts/ui-verify/fixtures/smoke.docx`).
      const paragraph = "Smoke fixture paragraph";
      const mounted = await page.waitFor(
        `document.querySelectorAll('[class*="docx-"]').length > 0`,
        30000,
      );
      const textRendered = await page.waitFor(
        `(document.body.innerText || '').includes(${JSON.stringify(paragraph)})`,
        20000,
      );
      const state = json(
        await page.evaluate(`JSON.stringify({
                docxNodes: document.querySelectorAll('[class*="docx-"]').length,
                canvases: document.querySelectorAll('canvas').length,
                text: (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 160),
            })`),
      );
      expect(mounted, `the Word editor never rendered: ${JSON.stringify(state)}`);
      expect(
        textRendered,
        `the document text is missing from the rendered page: ${JSON.stringify(state)}`,
      );
      return `${state.docxNodes} editor nodes, fixture paragraph rendered`;
    },
  },
  {
    name: "parquet-prefetch",
    async run({ page, base, stats }) {
      await openParquet(page, base, "?mixed=1");
      const before = await stats();
      await clickNextPage(page);
      const after = await stats();
      const delta = after.ranged - before.ranged;
      expect(delta === 0, `page 2 needed ${delta} extra range requests (prefetch is broken)`);
      const state = await pagerState(page);
      expect(state.range === "51–100 of 300", `page 2 did not render: ${state.range}`);
      return `next page served from cache (0 extra reads)`;
    },
  },
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
        results.push({
          name: scenario.name,
          ok: false,
          detail: error.message,
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
