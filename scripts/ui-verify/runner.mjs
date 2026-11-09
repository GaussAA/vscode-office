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
  if (!ready) {
    // A bare "did not render" tells a flake investigation nothing. Say what the page shows.
    const diagnostic = await page.evaluate(`JSON.stringify({
      url: location.href,
      bodyText: (document.body?.innerText ?? "").slice(0, 160).replace(/\\s+/g, " "),
      tree: document.querySelectorAll(".jsonl-index__tree").length,
    })`);
    expect(false, `JSONL directory did not render: ${diagnostic}`);
  }
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
    name: "parquet-zstd",
    docs: "parquet-zstd.png",
    async run({ page, base }) {
      // No query: the harness serves `sample.parquet`, the committed ZSTD fixture. Rendering
      // it at all proves hyparquet-compressors decoded the columns.
      await openParquet(page, base, "");
      const state = await pagerState(page);
      expect(state.range === "1–50 of 300", `zstd range: ${state.range}`);
      expect(state.first === "1", `zstd first row: ${state.first}`);
      const names = json(
        await page.evaluate(
          `JSON.stringify([...document.querySelectorAll('.parquet-viewer__list-name')].map(n => n.textContent))`,
        ),
      );
      expect(names.join(",") === "f32,f64", `zstd columns: ${names.join(",")}`);
      return `ZSTD sample: ${state.range}, ${names.join("/")}`;
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
      const pagerTitles = json(
        await page.evaluate(`JSON.stringify({
                previous: document.querySelector('button[aria-label="Previous page"]')?.getAttribute('title') ?? null,
                next: document.querySelector('button[aria-label="Next page"]')?.getAttribute('title') ?? null,
            })`),
      );
      expect(
        pagerTitles.previous === "Previous page" && pagerTitles.next === "Next page",
        `pager titles: ${JSON.stringify(pagerTitles)}`,
      );
      return `1–50 then 51–100 of 300`;
    },
  },
  {
    name: "parquet-sidebar",
    async run({ page, base }) {
      await openParquet(page, base, "?mixed=1");
      const state = json(
        await page.evaluate(`JSON.stringify({
                stats: [...document.querySelectorAll('.parquet-viewer__stat')].map((element) => {
                    const style = getComputedStyle(element);
                    return { border: style.borderTopWidth, shadow: style.boxShadow };
                }),
            })`),
      );
      expect(state.stats.length === 3, `stat rows: ${state.stats.length}`);
      expect(
        state.stats.every((stat) => stat.border === "0px"),
        `stat borders: ${JSON.stringify(state.stats)}`,
      );
      expect(
        state.stats.every((stat) => stat.shadow === "none"),
        `stat shadows: ${JSON.stringify(state.stats)}`,
      );
      return `${state.stats.length} borderless stat rows`;
    },
  },
  {
    name: "parquet-nested-columns",
    async run({ page, base }) {
      await openParquet(page, base, "?nested=1");

      const state = json(
        await page.evaluate(`JSON.stringify({
                names: [...document.querySelectorAll('.parquet-viewer__list-name')].map(n => n.textContent),
                firstRow: [...document.querySelectorAll('.parquet-table tbody tr:nth-child(2) .parquet-viewer__cell')].map(n => n.textContent),
            })`),
      );
      expect(
        state.names.join(",") === "id,tags,meta",
        `nested column names: ${state.names.join(",")}`,
      );
      expect(
        !state.names.some((name) => name.includes(".list.element")),
        "a physical leaf path leaked into the column list",
      );
      expect(
        state.firstRow.join("|").includes('["ko","en"]'),
        `LIST cell did not render JSON: ${state.firstRow.join("|")}`,
      );
      return "top-level names + JSON cell";
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
    name: "parquet-large-jump",
    docs: "parquet-large-file.png",
    async run({ page, base }) {
      await openParquet(page, base, "?big=1");
      const state = await pagerState(page);
      expect(state.range === "1–50 of 250,000", `large range: ${state.range}`);

      // A blur applies the jump too: the Go button is optional.
      await page.evaluate(`(() => {
                const input = document.querySelector('.parquet-viewer__row-jump input');
                const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                setter.call(input, '100');
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.focus();
                input.blur();
            })()`);
      const blurred = await page.waitFor(
        `(document.querySelector('.parquet-viewer__pager-info')?.innerText ?? '') === '51–100 of 250,000'`,
      );
      expect(blurred, "blur did not apply the row jump");

      await page.evaluate(`(() => {
                const input = document.querySelector('.parquet-viewer__row-jump input');
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
      return "read-only + blur and Go jumps";
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
      const hint = await page.evaluate(
        `document.querySelector('.parquet-viewer__inspector-hint')?.innerText ?? null`,
      );
      expect(hint === "Select a cell to inspect it", `inspector hint: ${hint}`);
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

      // The inspector must not sit on top of the table scroll area: that is what hid the
      // horizontal scrollbar and the last rows when it was an overlay.
      const layout = json(
        await page.evaluate(`JSON.stringify({
                insideTable: !!document.querySelector('.parquet-viewer__table-wrap .parquet-viewer__inspector'),
                tableBodyBottom: document.querySelector('.parquet-table .ant-table-body')?.getBoundingClientRect().bottom ?? -1,
                inspectorTop: document.querySelector('.parquet-viewer__inspector')?.getBoundingClientRect().top ?? -1,
                inspectorBottom: document.querySelector('.parquet-viewer__inspector')?.getBoundingClientRect().bottom ?? -1,
                footerTop: document.querySelector('.parquet-viewer__footer')?.getBoundingClientRect().top ?? -1,
            })`),
      );
      expect(layout.tableBodyBottom > 0, "table body not found");
      expect(layout.inspectorTop >= 0, "inspector not found");
      expect(!layout.insideTable, "inspector is inside the table scroll area");
      expect(
        layout.inspectorTop >= layout.tableBodyBottom - 1,
        `inspector overlaps the table body: ${layout.tableBodyBottom} > ${layout.inspectorTop}`,
      );
      expect(
        layout.footerTop < 0 || layout.inspectorBottom <= layout.footerTop + 1,
        `inspector overlaps the footer: ${layout.inspectorBottom} > ${layout.footerTop}`,
      );

      return `${state.label} = ${state.value}`;
    },
  },
  {
    name: "parquet-inspector-clears",
    async run({ page, base }) {
      await openParquet(page, base, "?mixed=1");
      await page.evaluate(`(() => {
                const cell = document.querySelector('.parquet-table tbody tr:nth-child(2) td:nth-child(3) .parquet-viewer__cell');
                cell.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            })()`);
      const inspected = await page.waitFor(
        `/name · row 1/.test(document.querySelector('.parquet-viewer__inspector-label')?.innerText ?? '')`,
      );
      expect(inspected, "inspector never opened before the page change");
      await clickNextPage(page);
      const cleared = await page.evaluate(`!document.querySelector('.parquet-viewer__inspector')`);
      expect(cleared, "inspector survived a page change");
      return "inspector cleared on page change";
    },
  },
  {
    name: "parquet-bool-cursor-jump",
    async run({ page, base }) {
      await openParquet(page, base, "?mixed=1");

      // Booleans split into true/false colours: false stops reading as a wall of accent.
      const boolState = json(
        await page.evaluate(`JSON.stringify({
                trues: document.querySelectorAll('.parquet-viewer__cell--bool-true').length,
                falses: document.querySelectorAll('.parquet-viewer__cell--bool-false').length,
                legacy: document.querySelectorAll('.parquet-viewer__cell--bool').length,
            })`),
      );
      expect(
        boolState.trues > 0 && boolState.falses > 0,
        `boolean cells not split into true/false: ${JSON.stringify(boolState)}`,
      );
      expect(boolState.legacy === 0, "the unsplit --bool class is still rendered");

      // Keyboard: focus the table area, arrow to a cell, Enter inspects it.
      const heightBefore = await page.evaluate(
        `document.querySelector('.parquet-table')?.getBoundingClientRect().height ?? 0`,
      );
      await page.evaluate(`(() => {
            const wrap = document.querySelector('.parquet-viewer__table-wrap');
            wrap.focus();
            const press = (key) => wrap.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
            press('ArrowRight');
            press('ArrowDown');
        })()`);
      const cursorShown = await page.waitFor(
        `!!document.querySelector('.parquet-viewer__cell--cursor')`,
      );
      expect(cursorShown, "keyboard cursor never appeared");
      const focused = await page.waitFor(
        `document.activeElement?.classList.contains('parquet-viewer__cell--cursor')`,
      );
      expect(focused, "cursor cell did not take focus");
      const focusState = json(
        await page.evaluate(`JSON.stringify({
                tabIndex: document.activeElement?.getAttribute('tabindex'),
                label: document.activeElement?.getAttribute('aria-label') ?? '',
                tabStops: document.querySelectorAll('.parquet-viewer__cell[tabindex="0"]').length,
            })`),
      );
      expect(focusState.tabIndex === "0", `cursor cell tabindex: ${focusState.tabIndex}`);
      expect(/name, row 2/.test(focusState.label), `cursor cell aria-label: ${focusState.label}`);
      expect(focusState.tabStops === 1, `roving tab stops: ${focusState.tabStops}`);
      await page.evaluate(
        `document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`,
      );
      const inspected = await page.waitFor(
        `/name · row 2/.test(document.querySelector('.parquet-viewer__inspector-label')?.innerText ?? '')`,
      );
      expect(inspected, "Enter did not inspect the cursor cell (name · row 2)");
      // The inspector must not reflow the grid: reflow is what made double-click-to-edit
      // land on a different cell when it squeezed the table.
      const heightAfter = await page.evaluate(
        `document.querySelector('.parquet-table')?.getBoundingClientRect().height ?? 0`,
      );
      expect(
        heightBefore === heightAfter,
        `table reflowed when the inspector opened: ${heightBefore} -> ${heightAfter}`,
      );

      // The footer jump lands on the right page AND highlights the target row.
      await page.evaluate(`(() => {
            const input = document.querySelector('.parquet-viewer__row-jump input');
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            setter.call(input, '123');
            input.dispatchEvent(new Event('input', { bubbles: true }));
            [...document.querySelectorAll('.parquet-viewer__pager-btn')]
                .find(b => b.textContent.trim() === 'Go')
                ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        })()`);
      const targeted = await page.waitFor(
        `!!document.querySelector('.parquet-viewer__row--target')`,
        15000,
      );
      expect(targeted, "jump never highlighted the target row");
      const range = await page.evaluate(
        `document.querySelector('.parquet-viewer__pager-info')?.innerText ?? ''`,
      );
      expect(range === "101–150 of 300", `jump page range: ${range}`);
      return "bool split + keyboard cursor + overlay inspector + target row";
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
      // The count renders as soon as the scan finishes, but the match sits on another page:
      // the jump is a page load, so the highlighted cell arrives one read later. Waiting for
      // the count alone raced that load (the scan got fast enough for the count to win).
      const highlighted = await page.waitFor(
        `document.querySelectorAll('.parquet-viewer__hit').length > 0`,
        15000,
      );
      expect(highlighted, "the matched cell never got highlighted");
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
    name: "remaining-routes-smoke",
    async run({ page, base }) {
      // The routes without a behavioural scenario of their own: the spreadsheet viewer and the
      // Git History panel. Mount-only is enough — their real assertions live in unit tests
      // (excel_find) and in the smoke suite's routing checks.
      const routes = ["excel", "gitHistory"];
      const failures = [];
      for (const route of routes) {
        page.clearExceptions();
        await page.navigate(`${base}/harness-route?route=${route}`);
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
