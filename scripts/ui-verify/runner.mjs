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
  // JSONL restores the selected entry per document. Scenarios share one profile, so
  // without clearing it the next scenario could start on L11 (too-large) instead of L1.
  await page.navigate(`${base}/stats`);
  await page.evaluate(`Object.keys(localStorage)
        .filter(key => key.startsWith('jsonl-state:'))
        .forEach(key => localStorage.removeItem(key))`);
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

async function openEmptyJsonl(page, base) {
  await page.navigate(`${base}/stats`);
  await page.evaluate(`Object.keys(localStorage)
        .filter(key => key.startsWith('jsonl-state:'))
        .forEach(key => localStorage.removeItem(key))`);
  await page.navigate(`${base}/harness?empty=1`);
  const ready = await page.waitFor(`!!document.querySelector('.jsonl-empty--viewer')`);
  expect(ready, "empty JSONL file did not render its empty state");
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
        .filter(key => key.startsWith('parquet-state:') || key === 'parquet-sider-width')
        .forEach(key => localStorage.removeItem(key))`);
  await page.navigate(`${base}/harness-parquet${query}`);
  // A real page has cells; an empty file renders antd's empty state; a broken one renders
  // the error panel. All three are successful mounts and each has its own assertions.
  const ready = await page.waitFor(
    query.includes("bad=1")
      ? `!!document.querySelector('.parquet-viewer__error')`
      : query.includes("empty=1")
        ? `!!document.querySelector('.parquet-viewer__no-rows')`
        : `!!document.querySelector('.parquet-viewer__cell')
            && !!document.querySelector('.parquet-table .ant-table-row')`,
  );
  expect(ready, "parquet table did not render");
}

/**
 * Rows and cells without assuming the table's DOM shape.
 *
 * antd draws a classic `<tr>/<td>` body by default and a div-based list when `virtual` is on.
 * Both keep `.ant-table-row` and `.ant-table-cell`, and the hidden measure row is not an
 * `.ant-table-row` in either — so indexing by that class is stable, while
 * `tr:nth-child(2)` ("the first data row") moves when the measure row disappears.
 */
const ROWS = "[...document.querySelectorAll('.parquet-table .ant-table-row')]";
/** A cell of the first data row by column position (index column included). */
const firstRowCell = (column) => `(${ROWS}[0])?.children[${column}]`;

const pagerState = (page) =>
  page
    .evaluate(`JSON.stringify({
    range: document.querySelector('.parquet-viewer__pager-info')?.innerText ?? null,
    first: (${ROWS}[0])?.children[0]?.innerText ?? null,
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

/** WCAG contrast of an element's text against its nearest painted background. */
const contrastRatio = (page, selector) =>
  page.evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return null;
    const parse = (value) => {
      const match = value.match(/rgba?\\(\\s*([\\d.]+)\\s*,\\s*([\\d.]+)\\s*,\\s*([\\d.]+)(?:\\s*,\\s*([\\d.]+))?/i);
      return match ? [Number(match[1]), Number(match[2]), Number(match[3]), match[4] === undefined ? 1 : Number(match[4])] : null;
    };
    const luminance = ([r, g, b]) => {
      const channel = (value) => {
        const v = value / 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    };
    const fg = parse(getComputedStyle(element).color);
    if (!fg) return null;
    let node = element;
    let bg = null;
    while (node) {
      const candidate = parse(getComputedStyle(node).backgroundColor);
      if (candidate && candidate[3] >= 0.5) {
        bg = candidate;
        break;
      }
      node = node.parentElement;
    }
    if (!bg) bg = [255, 255, 255, 1];
    const light = Math.max(luminance(fg), luminance(bg));
    const dark = Math.min(luminance(fg), luminance(bg));
    return (light + 0.05) / (dark + 0.05);
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
                actionInBottomBar: !!document.querySelector('.jsonl-bottombar .jsonl-detail__header'),
                toolbarBorder: getComputedStyle(document.querySelector('.jsonl-toolbar')).borderBottomWidth,
            })`),
      );
      expect(state.file === "events.jsonl", `unexpected file name: ${state.file}`);
      expect(state.rows >= 10, `directory rendered ${state.rows} rows`);
      expect(state.index === "L1", `unexpected first selection: ${state.index}`);
      expect(/entries/.test(state.meta ?? ""), `missing entry count: ${state.meta}`);
      expect(state.actionInBottomBar, "detail actions are not in the bottom bar");
      expect(state.toolbarBorder === "0px", `toolbar border: ${state.toolbarBorder}`);
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
      const sawStatus = await page.waitFor(`!!document.querySelector('.jsonl-search-status')`);
      expect(sawStatus, "search status never appeared");
      const sawHits = await page.waitFor(`document.querySelectorAll('.jsonl-hit').length > 0`);
      expect(sawHits, "no match highlighting rendered");
      // Settled means: a match count, and no longer "Searching…".
      const settled = await page.waitFor(`(() => {
                const text = document.querySelector('.jsonl-search-status')?.innerText ?? '';
                return /\\d+ match/.test(text) && !text.includes('Searching');
            })()`);
      expect(settled, "search status never settled on a match count");
      const state = json(
        await page.evaluate(`JSON.stringify({
                status: document.querySelector('.jsonl-search-status')?.innerText ?? null,
                hits: document.querySelectorAll('.jsonl-hit').length,
            })`),
      );
      expect(/(\d+) match/.test(state.status ?? ""), `unexpected status: ${state.status}`);
      expect(state.hits > 0, "no match highlighting rendered");
      return `${state.status}, ${state.hits} highlighted runs`;
    },
  },
  {
    name: "jsonl-empty",
    async run({ page, base }) {
      await openEmptyJsonl(page, base);
      const state = json(
        await page.evaluate(`JSON.stringify({
                meta: document.querySelector('.jsonl-meta')?.innerText ?? null,
                empty: document.querySelector('.jsonl-empty--viewer')?.innerText ?? null,
                split: !!document.querySelector('.jsonl-splitter'),
                bar: !!document.querySelector('.jsonl-bottombar'),
                jumpDisabled: document.querySelector('.jsonl-jump input')?.disabled ?? null,
                goDisabled: [...document.querySelectorAll('.jsonl-toolbar button')]
                    .find(b => b.textContent.trim() === 'Go')?.disabled ?? null,
            })`),
      );
      expect(/0 entries/.test(state.meta ?? ""), `unexpected empty meta: ${state.meta}`);
      expect(state.empty === "No entries", `unexpected empty state: ${state.empty}`);
      expect(!state.split, "empty file still rendered a two-pane split");
      expect(!state.bar, "empty file still rendered a bottom bar");
      expect(state.jumpDisabled === true, "jump accepted input with no lines");
      expect(state.goDisabled === true, "Go stayed enabled with no lines");
      return "empty file: one empty state, no row identity, jump disabled";
    },
  },
  {
    name: "jsonl-no-matches",
    async run({ page, base }) {
      await openJsonl(page, base);
      await page.evaluate(`(() => {
                const input = document.querySelector('.jsonl-search input');
                const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                input.focus();
                setter.call(input, 'zzzz-no-such-entry');
                input.dispatchEvent(new Event('input', { bubbles: true }));
            })()`);
      const status = await page.waitFor(`(() => {
                const text = document.querySelector('.jsonl-search-status')?.innerText ?? '';
                return text.includes('No matches');
            })()`);
      expect(status, "no-match status never settled");
      const state = json(
        await page.evaluate(`JSON.stringify({
                status: document.querySelector('.jsonl-search-status')?.innerText ?? null,
                left: document.querySelector('.jsonl-index .jsonl-empty')?.innerText ?? null,
                hits: document.querySelectorAll('.jsonl-hit').length,
            })`),
      );
      expect(state.left === "No matches", `directory empty state is ${state.left}`);
      expect(state.hits === 0, `unexpected ${state.hits} highlighted hits`);
      return "no matches: status + empty directory";
    },
  },
  {
    name: "jsonl-invalid-entry",
    async run({ page, base }) {
      await openJsonl(page, base);
      await jumpJsonl(page, 3);
      const state = json(
        await page.evaluate(`JSON.stringify({
                error: document.querySelector('.jsonl-detail__error .jsonl-chip--error')?.innerText ?? null,
                raw: document.querySelector('.jsonl-detail__error .jsonl-detail__raw')?.innerText ?? null,
                chip: document.querySelector('.jsonl-detail__header .jsonl-chip--error')?.innerText ?? null,
            })`),
      );
      expect(
        /Invalid JSON/i.test(state.error ?? ""),
        `missing invalid-JSON explanation: ${state.error}`,
      );
      expect(/broken/.test(state.raw ?? ""), "invalid raw line was not shown");
      expect(/^invalid/.test(state.chip ?? ""), `directory/bottom chip is ${state.chip}`);
      return "invalid line: error chip + raw text";
    },
  },
  {
    name: "jsonl-too-large",
    async run({ page, base }) {
      await openJsonl(page, base);
      await jumpJsonl(page, 11);
      const state = json(
        await page.evaluate(`JSON.stringify({
                warn: document.querySelector('.jsonl-detail__error .jsonl-chip--warn')?.innerText ?? null,
                directory: document.querySelector('.jsonl-index .jsonl-chip--warn')?.innerText ?? null,
                raw: document.querySelector('.jsonl-detail__error .jsonl-detail__raw')?.innerText.length ?? 0,
            })`),
      );
      expect(/too large/i.test(state.warn ?? ""), `missing too-large explanation: ${state.warn}`);
      expect(
        /too large/i.test(state.directory ?? ""),
        `missing directory warn chip: ${state.directory}`,
      );
      expect(state.raw > 0 && state.raw < 1000, `too-large raw text is ${state.raw} chars`);
      return "too-large line: warn chip, truncated raw text";
    },
  },
  {
    name: "parquet-empty",
    async run({ page, base }) {
      await openParquet(page, base, "?empty=1");
      const state = json(
        await page.evaluate(`JSON.stringify({
                range: document.querySelector('.parquet-viewer__pager-info')?.innerText ?? null,
                empty: document.querySelector('.parquet-viewer__no-rows')?.innerText ?? null,
                columns: document.querySelectorAll('.parquet-viewer__list-item').length,
                jumpDisabled: document.querySelector('.parquet-viewer__row-jump input')?.disabled ?? null,
                goDisabled: document.querySelector('[data-row-jump-go]')?.disabled ?? null,
                cells: document.querySelectorAll('.parquet-viewer__cell').length,
            })`),
      );
      expect(state.range === "No rows", `empty pager says ${state.range}`);
      expect(state.empty === "No rows", `table empty text is ${state.empty}`);
      expect(state.columns === 1, `sidebar rendered ${state.columns} columns`);
      expect(state.cells === 0, `empty file rendered ${state.cells} cells`);
      expect(state.jumpDisabled === true, "jump accepted a row in an empty file");
      expect(state.goDisabled === true, "Go stayed enabled in an empty file");
      return "0 rows: explicit empty state, sized chrome";
    },
  },
  {
    name: "parquet-edge-types",
    async run({ page, base }) {
      await openParquet(page, base, "?types=1");
      const state = json(
        await page.evaluate(`JSON.stringify((() => {
                const headers = [...document.querySelectorAll('.parquet-table thead th')];
                const longHeader = headers.find(h => h.innerText.toLowerCase().includes('very long column'));
                const cells = [...((${ROWS}[0])?.children ?? [])];
                return {
                    headers: headers.map(h => h.innerText),
                    longHeaderHeight: longHeader ? Math.round(longHeader.getBoundingClientRect().height) : 0,
                    longHeaderTitle: longHeader?.getAttribute('title') ?? null,
                    missing: cells[2]?.innerText ?? null,
                    when: cells[3]?.innerText ?? null,
                    blob: cells[5]?.innerText ?? null,
                };
            })())`),
      );
      expect(state.headers.length === 6, `rendered ${state.headers.length} headers`);
      expect(/very long column name/i.test(state.headers.join(" ")), "long unicode header missing");
      expect(state.longHeaderHeight <= 40, `long header wrapped to ${state.longHeaderHeight}px`);
      expect(state.longHeaderTitle, "long header has no title for the full name");
      expect(/^null$/i.test(state.missing ?? ""), `null cell rendered as ${JSON.stringify(state)}`);
      expect(/^\d{4}-\d{2}-\d{2}T/.test(state.when ?? ""), `timestamp rendered as ${state.when}`);
      expect(state.blob === "0x00 01 02 ff", `binary rendered as ${state.blob}`);
      return "null / timestamp / binary / long unicode header";
    },
  },
  {
    name: "parquet-error",
    async run({ page, base }) {
      await openParquet(page, base, "?bad=1");
      const state = json(
        await page.evaluate(`JSON.stringify({
                file: document.querySelector('.parquet-viewer__error-file-name')?.innerText ?? null,
                title: document.querySelector('.parquet-viewer__error-title')?.innerText ?? null,
                text: document.querySelector('.parquet-viewer__error-text')?.innerText ?? null,
                detail: document.querySelector('.parquet-viewer__error-raw pre')?.textContent ?? null,
                buttons: [...document.querySelectorAll('.parquet-viewer__error-actions button')]
                    .map(b => b.textContent.trim()),
                role: document.querySelector('.parquet-viewer__error')?.getAttribute('role') ?? null,
                table: !!document.querySelector('.parquet-table'),
            })`),
      );
      // This state loses the whole chrome, so the file has to be named here or nowhere.
      expect(state.file === "parquet-sample", `error state does not name the file: ${state.file}`);
      // The headline is a sentence; the parser's own words live under the details.
      expect(
        !!state.title && !/footer|PAR1|invalid/i.test(state.title),
        `error title is still the parser's message: ${state.title}`,
      );
      expect(
        /truncated|not a parquet/i.test(state.text ?? ""),
        `error body does not explain the file: ${state.text}`,
      );
      expect(
        /footer|PAR1|parquet/i.test(state.detail ?? ""),
        `raw message is gone: ${state.detail}`,
      );
      // The whole chrome is gone in this state; without a live region a screen-reader user
      // gets no announcement at all, only an empty page.
      expect(state.role === "alert", `error state is not announced (role=${state.role})`);
      expect(
        state.buttons.includes("Retry") && state.buttons.includes("Reveal in Explorer"),
        `error state has no way out: ${JSON.stringify(state.buttons)}`,
      );
      expect(!state.table, "a broken file still rendered a table");
      return "broken file: named, explained, escapable";
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
      // The reason this fork exists is that it decodes what upstream cannot. Say so.
      const codec = await page.evaluate(
        `[...document.querySelectorAll('.parquet-viewer__meta-item')]
                .map(item => item.innerText.replace(/\\s+/g, ' ').trim())
                .find(text => /ZSTD/i.test(text)) ?? null`,
      );
      expect(codec, "the ZSTD codec is not shown anywhere in the top bar");
      const align = json(
        await page.evaluate(`JSON.stringify({
                header: getComputedStyle(document.querySelectorAll('.ant-table-thead th')[1]).textAlign,
                cell: getComputedStyle(${firstRowCell(1)}).textAlign,
                value: getComputedStyle(${firstRowCell(1)}.querySelector('.parquet-viewer__cell')).textAlign,
            })`),
      );
      expect(
        align.header === "right" && align.cell === "right" && align.value === "right",
        `numeric alignment: ${JSON.stringify(align)}`,
      );
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
                meta: [...document.querySelectorAll('.parquet-viewer__meta-item')].map((element) => element.innerText.trim()),
                siderBorder: getComputedStyle(document.querySelector('.parquet-viewer__sider')).borderRightWidth,
                topbarBorder: getComputedStyle(document.querySelector('.parquet-viewer__topbar')).borderBottomWidth,
                footerBorder: getComputedStyle(document.querySelector('.parquet-viewer__bottombar')).borderTopWidth,
            })`),
      );
      // Rows, columns, codec, author — the codec is what tells the reader this fork is why the
      // file opened at all.
      expect(
        state.meta.length === 4 && state.meta.some((item) => /CODEC/i.test(item)),
        `topbar meta items: ${JSON.stringify(state.meta)}`,
      );
      expect(
        state.siderBorder === "0px" && state.topbarBorder === "0px" && state.footerBorder === "0px",
        `region borders: ${JSON.stringify(state)}`,
      );

      const before = await page.evaluate(
        `document.querySelector('.parquet-viewer__sider').getBoundingClientRect().width`,
      );
      await page.evaluate(`(() => {
                const handle = document.querySelector('.parquet-viewer__resizer');
                handle.focus();
                handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
            })()`);
      const after = await page.evaluate(
        `document.querySelector('.parquet-viewer__sider').getBoundingClientRect().width`,
      );
      expect(after === before + 16, `resizer width: ${before} -> ${after}`);

      // 60 fields used to be 60 tab stops between the search box and the grid.
      const stops = await page.evaluate(
        `[...document.querySelectorAll('.parquet-viewer__list-item')].filter(b => b.tabIndex === 0).length`,
      );
      expect(stops === 1, `the schema list exposes ${stops} tab stops`);

      // The filter narrows the list, never the table.
      await page.evaluate(`(() => {
                const input = document.querySelector('.parquet-viewer__field-filter');
                const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                setter.call(input, 'na');
                input.dispatchEvent(new Event('input', { bubbles: true }));
            })()`);
      const filtered = json(
        await page.evaluate(`JSON.stringify({
                names: [...document.querySelectorAll('.parquet-viewer__list-name')].map(n => n.textContent),
                columns: document.querySelector('.parquet-viewer__table-wrap')?.getAttribute('aria-colcount'),
                count: document.querySelector('.parquet-viewer__sider-count')?.innerText,
            })`),
      );
      expect(
        filtered.names.join(",") === "name" && filtered.columns === "5",
        `filter changed the wrong thing: ${JSON.stringify(filtered)}`,
      );
      expect(
        filtered.count === "1/4",
        `the heading count does not show the filter: ${filtered.count}`,
      );

      // Arrow keys walk the filtered list and bring the field into view.
      await page.evaluate(`(() => {
                const item = document.querySelector('.parquet-viewer__list-item');
                item.focus();
                item.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
            })()`);
      const walked = await page.evaluate(
        `document.querySelector('.parquet-viewer__list-item')?.getAttribute('aria-selected')`,
      );
      expect(walked === "true", `arrow keys did not activate the field: ${walked}`);

      // A clipped badge made TIMESTAMP_MILLIS and TIMESTAMP_MICROS identical.
      const clipped = json(
        await page.evaluate(`JSON.stringify([...document.querySelectorAll('.parquet-viewer__list-type')]
                .filter(badge => badge.scrollWidth > badge.clientWidth + 1)
                .map(badge => badge.textContent))`),
      );
      expect(clipped.length === 0, `type badges are clipped: ${JSON.stringify(clipped)}`);

      // Clear the filter: this scenario also produces the documentation screenshot, and a
      // sidebar with one of four fields hidden is the wrong thing to document.
      await page.evaluate(`(() => {
                const input = document.querySelector('.parquet-viewer__field-filter');
                const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                setter.call(input, '');
                input.dispatchEvent(new Event('input', { bubbles: true }));
            })()`);
      const restored = await page.waitFor(
        `document.querySelectorAll('.parquet-viewer__list-item').length === 4`,
        4000,
      );
      expect(restored, "the field filter did not clear");

      return `${state.meta.length} inline meta items, filterable schema, one tab stop`;
    },
  },
  {
    name: "parquet-grid-semantics",
    async run({ page, base }) {
      await openParquet(page, base, "?mixed=1");
      const state = json(
        await page.evaluate(`JSON.stringify((() => {
                const wrap = document.querySelector('.parquet-viewer__table-wrap');
                const rows = [...document.querySelectorAll('.ant-table-tbody-virtual-holder-inner > *')];
                const cells = [...(rows[0]?.querySelectorAll('.ant-table-cell') ?? [])];
                const header = [...document.querySelectorAll('.parquet-table thead th')];
                return {
                    grid: wrap?.getAttribute('role'),
                    rowcount: wrap?.getAttribute('aria-rowcount'),
                    colcount: wrap?.getAttribute('aria-colcount'),
                    label: wrap?.getAttribute('aria-label'),
                    rowRole: rows[0]?.getAttribute('role'),
                    rowIndex: rows[0]?.getAttribute('aria-rowindex'),
                    cellRole: cells[1]?.getAttribute('role'),
                    cellCol: cells[1]?.getAttribute('aria-colindex'),
                    indexRole: cells[0]?.getAttribute('role'),
                    indexCol: cells[0]?.getAttribute('aria-colindex'),
                    headerRoles: [...new Set(header.map(th => th.getAttribute('role')))],
                    headerCols: header.map(th => th.getAttribute('aria-colindex')),
                    tableRoles: [...new Set([...document.querySelectorAll('.parquet-table table')]
                        .map(t => t.getAttribute('role')))],
                };
            })())`),
      );
      // The keyboard model is a grid: roving tabindex, arrows, Enter. Without the roles a
      // screen reader sees a flat run of labelled spans and cannot say which column a cell is in.
      expect(state.grid === "grid", `the table is not a grid (role=${state.grid})`);
      expect(state.rowcount === "300", `grid row count: ${state.rowcount}`);
      expect(state.colcount === "5", `grid column count: ${state.colcount}`);
      expect(state.label === "parquet-sample", `grid is unnamed: ${state.label}`);
      expect(state.rowRole === "row", `row role: ${state.rowRole}`);
      expect(state.rowIndex === "1", `first row is not row 1: ${state.rowIndex}`);
      expect(state.cellRole === "gridcell", `cell role: ${state.cellRole}`);
      expect(state.cellCol === "2", `cell column index: ${state.cellCol}`);
      expect(state.indexRole === "rowheader", `index column role: ${state.indexRole}`);
      expect(state.indexCol === "1", `index column position: ${state.indexCol}`);
      expect(
        state.headerRoles.length === 1 && state.headerRoles[0] === "columnheader",
        `header roles: ${JSON.stringify(state.headerRoles)}`,
      );
      expect(
        state.headerCols[0] === "1" && state.headerCols.at(-1) === "5",
        `header column indices: ${JSON.stringify(state.headerCols)}`,
      );
      // A `<table>` inside a `grid` is not a valid child; the header shell keeps its cells but
      // loses the table role.
      expect(
        state.tableRoles.length === 1 && state.tableRoles[0] === "presentation",
        `header table role: ${JSON.stringify(state.tableRoles)}`,
      );
      return "grid roles, row/column indices and an unnamed header shell";
    },
  },
  {
    name: "parquet-nested-columns",
    async run({ page, base }) {
      await openParquet(page, base, "?nested=1");

      const state = json(
        await page.evaluate(`JSON.stringify({
                names: [...document.querySelectorAll('.parquet-viewer__list-name')].map(n => n.textContent),
                firstRow: [...((${ROWS}[0])?.querySelectorAll('.parquet-viewer__cell') ?? [])].map(n => n.textContent),
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
      const syntax = json(
        await page.evaluate(`JSON.stringify({
                strings: document.querySelectorAll('.parquet-viewer__cell--json .parquet-viewer__json-token--string').length,
                punct: document.querySelectorAll('.parquet-viewer__cell--json .parquet-viewer__json-token--punct').length,
            })`),
      );
      expect(syntax.strings >= 2, `LIST strings were not tokenised: ${JSON.stringify(syntax)}`);
      expect(syntax.punct >= 3, `LIST punctuation was not tokenised: ${JSON.stringify(syntax)}`);
      return "top-level names + syntax-highlighted JSON cell";
    },
  },
  {
    name: "parquet-json-links-column-jump",
    async run({ page, base }) {
      await openParquet(page, base, "?preview=1");
      const before = json(
        await page.evaluate(`JSON.stringify({
                strings: document.querySelectorAll('.parquet-viewer__json-token--string').length,
                keys: document.querySelectorAll('.parquet-viewer__json-token--key').length,
                links: document.querySelectorAll('.parquet-viewer__cell--link a').length,
                unsafeLinks: [...document.querySelectorAll('.parquet-viewer__cell--link a')]
                    .filter(a => !/^https?:\\/\\//.test(a.getAttribute('href') ?? '')).length,
                // One tab stop for the whole grid: the anchor stays out of the tab order, so
                // the cell has to say that Enter opens it.
                linkTabs: [...new Set([...document.querySelectorAll('.parquet-viewer__cell-link')]
                    .map(a => a.getAttribute('tabindex')))],
                linkShortcuts: [...new Set([...document.querySelectorAll('.parquet-viewer__cell--link')]
                    .map(cell => cell.getAttribute('aria-keyshortcuts')))],
                urlHeaderLeft: document.querySelector('.parquet-table th:last-child')?.getBoundingClientRect().left ?? null,
                wrapRight: document.querySelector('.parquet-viewer__table-wrap')?.getBoundingClientRect().right ?? null,
            })`),
      );
      expect(before.strings > 0, `JSON list strings missing: ${JSON.stringify(before)}`);
      expect(before.keys > 0, `JSON object keys missing: ${JSON.stringify(before)}`);
      expect(before.links === 4, `expected 4 safe URL cells, got ${before.links}`);
      expect(before.unsafeLinks === 0, `unsafe href rendered: ${JSON.stringify(before)}`);
      expect(
        before.linkTabs.length === 1 && before.linkTabs[0] === "-1",
        `a link became a tab stop: ${JSON.stringify(before.linkTabs)}`,
      );
      expect(
        before.linkShortcuts.length === 1 && before.linkShortcuts[0] === "Enter",
        `the link cell does not advertise its key: ${JSON.stringify(before.linkShortcuts)}`,
      );

      const jump = json(
        await page.evaluate(`(() => {
                const item = [...document.querySelectorAll('.parquet-viewer__list-item')]
                    .find(button => button.querySelector('.parquet-viewer__list-name')?.textContent === 'url');
                item?.click();
                return JSON.stringify({ found: !!item });
            })()`),
      );
      expect(jump.found, "the url field is missing from the schema sidebar");
      // What has to become visible is the cell the user would click. The header is a second,
      // separately synced surface: measuring it here failed whenever the body had already
      // scrolled to its limit and the header had not caught up (body 1624 wide, scrolled to
      // its 385 px maximum, header still at 1749 against a 1500 right edge).
      const arrived = await page.waitFor(
        `(() => {
                const cell = document.querySelector('.parquet-viewer__cell--link')?.closest('.ant-table-cell, td');
                const wrap = document.querySelector('.parquet-viewer__table-wrap')?.getBoundingClientRect();
                if (!cell || !wrap) return false;
                const rect = cell.getBoundingClientRect();
                return rect.width > 0 && rect.left >= wrap.left && rect.left < wrap.right;
            })()`,
        6000,
      );
      if (!arrived) {
        const diag = await page.evaluate(`JSON.stringify((() => {
                const wrap = document.querySelector('.parquet-viewer__table-wrap');
                const body = wrap?.querySelector('.ant-table-tbody-virtual');
                const track = wrap?.querySelector('.ant-table-tbody-virtual-scrollbar-horizontal');
                const thumb = track?.querySelector('.ant-table-tbody-virtual-scrollbar-thumb');
                const inner = wrap?.querySelector('.ant-table-tbody-virtual-holder-inner');
                return {
                    wrapW: wrap?.clientWidth, wrapLeft: wrap?.getBoundingClientRect().left,
                    innerW: inner?.scrollWidth, innerLeft: inner?.getBoundingClientRect().left,
                    innerTransform: inner ? getComputedStyle(inner).transform : null,
                    trackW: track?.getBoundingClientRect().width,
                    thumbW: thumb?.getBoundingClientRect().width,
                    thumbLeft: thumb?.getBoundingClientRect().left,
                    headerLeft: document.querySelector('.parquet-table th:last-child')?.getBoundingClientRect().left,
                };
            })())`);
        throw new Error(`schema click did not bring the URL column into view: ${diag}`);
      }

      const after = json(
        await page.evaluate(`JSON.stringify({
                urlHeaderLeft: document.querySelector('.parquet-table th:last-child')?.getBoundingClientRect().left ?? null,
                wrapLeft: document.querySelector('.parquet-viewer__table-wrap')?.getBoundingClientRect().left ?? null,
                wrapRight: document.querySelector('.parquet-viewer__table-wrap')?.getBoundingClientRect().right ?? null,
                active: document.querySelectorAll('.parquet-viewer__list-item--active').length,
                pressed: document.querySelector('.parquet-viewer__list-item--active')?.getAttribute('aria-selected'),
                activeHeader: document.querySelectorAll('.parquet-table th.parquet-viewer__column--active').length,
                activeCell: document.querySelectorAll('.ant-table-tbody-virtual .ant-table-cell.parquet-viewer__column--active').length,
            })`),
      );
      expect(
        before.urlHeaderLeft !== null &&
          before.wrapRight !== null &&
          before.urlHeaderLeft >= before.wrapRight,
        `URL column was already visible before the jump: ${JSON.stringify(before)}`,
      );
      // The header's position is deliberately not asserted here: it is synced separately from
      // the body and can lag one frame behind the virtual scroller, which made this scenario
      // fail about one run in two while the cell itself was already in view. Visibility is
      // checked against the cell above; the header only has to carry its tint.
      expect(
        after.active === 1 && after.pressed === "true",
        `schema item not active: ${JSON.stringify(after)}`,
      );
      expect(after.activeHeader >= 1, `target header not tinted: ${JSON.stringify(after)}`);
      expect(after.activeCell > 0, `target cells not tinted: ${JSON.stringify(after)}`);

      const opened = json(
        await page.evaluate(`(async () => {
                document.querySelector('.parquet-viewer__cell--link a')?.click();
                await new Promise(resolve => setTimeout(resolve, 50));
                return JSON.stringify({
                    calls: window.__openExternalCalls ?? [],
                    href: document.querySelector('.parquet-viewer__cell--link a')?.getAttribute('href') ?? null,
                });
            })()`),
      );
      expect(
        opened.href === "https://huggingface.co/datasets/alpha",
        `link href was not normalised: ${opened.href}`,
      );
      expect(
        opened.calls.includes("https://huggingface.co/datasets/alpha"),
        `openExternal was not emitted: ${JSON.stringify(opened.calls)}`,
      );
      // The header is a separate scroll surface; a jump that moves only the body leaves the
      // column labels one or two columns away from the values under them.
      const alignment = json(
        await page.evaluate(`JSON.stringify((() => {
                const cell = document.querySelector('.parquet-viewer__cell--link')?.closest('.ant-table-cell, td');
                const head = [...document.querySelectorAll('.parquet-table thead th')].at(-1);
                if (!cell || !head) return { diff: null };
                return { diff: Math.abs(head.getBoundingClientRect().left - cell.getBoundingClientRect().left) };
            })())`),
      );
      expect(
        typeof alignment.diff === "number" && alignment.diff < 2,
        `header and body disagree by ${alignment.diff}px`,
      );
      return "JSON syntax + safe links + schema column jump (header aligned)";
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
          ` && (${ROWS}[0])?.children[0]?.innerText === '51'`,
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
      // The table is virtual: the first rendered row is whatever the scroller keeps on screen,
      // not the page's first row. What must be true is that the jumped-to row is the visible
      // target — a stronger statement than "the page starts where we asked".
      const target = await page.evaluate(
        `document.querySelector('.parquet-viewer__row--target')?.children[0]?.innerText ?? null`,
      );
      expect(target === "240000", `jump target row: ${target} (first rendered: ${jumped.first})`);
      // Landing on the row is not the same as seeing it: the tint is the only confirmation
      // that the jump arrived, and it lives on the virtual body's div cells.
      const tints = json(
        await page.evaluate(`JSON.stringify((() => {
                const rows = [...document.querySelectorAll('.ant-table-tbody-virtual-holder-inner > *')];
                const bg = (row) => row ? getComputedStyle(row.querySelector('.ant-table-cell') ?? row).backgroundColor : null;
                const plain = rows.find((row) => !/row--(alt|match|target)/.test(row.className));
                return { target: bg(document.querySelector('.parquet-viewer__row--target')), plain: bg(plain) };
            })())`),
      );
      expect(
        tints.target && tints.plain && tints.target !== tints.plain,
        "the jumped-to row carries no tint",
      );
      return "read-only + blur and Go jumps";
    },
  },
  {
    name: "parquet-inline-buffer",
    async run({ page, base }) {
      // A virtual document arrives as base64 in the payload (GitHub Repos, `git:` history).
      // Rendering it at all proves the decode, and the range proves it is the same file.
      await openParquet(page, base, "?inline=1");
      const state = await pagerState(page);
      expect(state.range === "1–50 of 300", `inline range: ${state.range}`);
      expect(state.first === "1", `inline first row: ${state.first}`);
      return `inline base64 payload: ${state.range}`;
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
      const lightFind = await luminance(page, ".parquet-viewer__search");
      const lightRow = await luminance(page, ".parquet-viewer__row-jump");
      expect(
        lightFind !== null && lightFind > 0.5,
        `search field stayed dark in a light theme (luminance ${lightFind})`,
      );
      expect(
        lightRow !== null && lightRow > 0.5,
        `row input stayed dark in a light theme (luminance ${lightRow})`,
      );
      return "antd + native inputs follow the VS Code theme";
    },
  },
  {
    name: "semantic-contrast",
    async run({ page, base }) {
      // Chart hues are for graphics, not 12px text on white. The viewer has its own
      // light-theme overrides; this is the check that keeps them above WCAG AA.
      await openParquet(page, base, "?mixed=1&theme=light");
      const parquet = {};
      for (const [key, selector] of [
        ["numeric", ".parquet-viewer__cell--numeric"],
        ["string", ".parquet-viewer__cell--string"],
        ["bool", ".parquet-viewer__cell--bool-true"],
        // The label layer: the smallest type in the surface, and the only layer the gate used
        // to leave unguarded. Measured 3.5–4.0:1 before the light override existed.
        ["badge", ".parquet-viewer__list-type"],
        ["header", ".parquet-table thead th"],
        ["sectionTitle", ".parquet-viewer__sider-title"],
      ]) {
        parquet[key] = await contrastRatio(page, selector);
      }
      for (const [kind, ratio] of Object.entries(parquet)) {
        expect(ratio !== null && ratio >= 4.5, `parquet ${kind} contrast is ${ratio}:1`);
      }

      await openParquet(page, base, "?preview=1&theme=light");
      await page.waitFor(`!!document.querySelector('.parquet-viewer__cell--link a')`);
      for (const [key, selector] of [
        ["link", ".parquet-viewer__cell--link a"],
        ["jsonKey", ".parquet-viewer__json-token--key"],
        ["jsonString", ".parquet-viewer__json-token--string"],
      ]) {
        parquet[key] = await contrastRatio(page, selector);
      }
      for (const [kind, ratio] of Object.entries(parquet)) {
        expect(ratio !== null && ratio >= 4.5, `parquet ${kind} contrast is ${ratio}:1`);
      }

      await openJsonl(page, base, "light");
      await page.waitFor(`!!document.querySelector('.jsonl-val--number')`);
      const jsonl = {};
      for (const [key, selector] of [
        ["numeric", ".jsonl-val--number"],
        ["string", ".jsonl-val--string"],
        ["bool", ".jsonl-val--boolean"],
      ]) {
        jsonl[key] = await contrastRatio(page, selector);
      }
      for (const [kind, ratio] of Object.entries(jsonl)) {
        expect(ratio !== null && ratio >= 4.5, `jsonl ${kind} contrast is ${ratio}:1`);
      }
      return `light text ≥ 4.5:1 (parquet min ${Math.min(...Object.values(parquet)).toFixed(1)}, jsonl min ${Math.min(...Object.values(jsonl)).toFixed(1)})`;
    },
  },
  {
    name: "parquet-keyboard-paging",
    async run({ page, base }) {
      await openParquet(page, base, "?mixed=1");
      const press = (key, extra = "") =>
        page.evaluate(`(() => {
                const wrap = document.querySelector('.parquet-viewer__table-wrap');
                wrap.focus();
                wrap.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true ${extra} }));
            })()`);
      const cursorAt = () =>
        page.evaluate(`document.activeElement?.getAttribute('data-cell') ?? null`);

      await press("ArrowDown");
      const started = await page.waitFor(
        `document.activeElement?.getAttribute('data-cell') === '0:0'`,
      );
      expect(started, `keyboard cursor did not start at 0:0 (${await cursorAt()})`);
      // The focus ring and the bottom bar must agree, including on the paths that only restore
      // a cursor (cold start, page turn) rather than walking to a cell.
      const firstRow = `[...document.querySelectorAll('.ant-table-tbody-virtual-holder-inner > *')][0]
                ?.querySelectorAll('.ant-table-cell')[1]?.innerText?.trim() ?? null`;
      const selection = async () =>
        json(
          await page.evaluate(`JSON.stringify({
                label: (document.querySelector('.parquet-viewer__selection-label')?.innerText ?? '').trim(),
                value: (document.querySelector('.parquet-viewer__selection-value')?.innerText ?? '').trim(),
                firstId: ${firstRow},
            })`),
        );
      // The focus ring and the bottom bar must agree, *and* the value must be the one under that
      // row number. A page turn used to leave "row 1" over a value from row 251.
      const synced = await selection();
      expect(
        /id · row 1\b/.test(synced.label) && synced.value === synced.firstId,
        `the bottom bar disagrees with the grid: ${JSON.stringify(synced)}`,
      );

      // PageDown moves by what the viewport shows, not by the 50-row page: a page-sized step
      // dropped a third of the rows without ever displaying them.
      await press("PageDown");
      const stepped = await page.waitFor(
        `(() => {
                const cell = document.activeElement?.getAttribute('data-cell') ?? '';
                const row = Number(cell.split(':')[0]);
                const range = document.querySelector('.parquet-viewer__pager-info')?.innerText ?? '';
                return row >= 10 && range === '1–50 of 300';
            })()`,
        5000,
      );
      expect(stepped, `PageDown did not step inside the page (${await cursorAt()})`);
      // Enough steps cross into the next page.
      await press("PageDown");
      await press("PageDown");
      const turned = await page.waitFor(
        `(document.querySelector('.parquet-viewer__pager-info')?.innerText ?? '') === '51–100 of 300'`,
        5000,
      );
      expect(turned, "repeated PageDown never crossed into the next page");

      // ArrowUp at the top of a page walks back to the previous page's last row.
      await press("ArrowUp");
      const back = await page.waitFor(
        `(document.querySelector('.parquet-viewer__pager-info')?.innerText ?? '') === '1–50 of 300'`,
        5000,
      );
      expect(back, "ArrowUp did not walk back a page");
      const onLast = await page.waitFor(
        `document.activeElement?.getAttribute('data-cell') === '49:0'`,
        5000,
      );
      expect(
        onLast,
        `the cursor did not land on the previous page's last row (${await cursorAt()})`,
      );

      // Ctrl+End reaches the end of the file; Ctrl+Home comes back.
      await press("End", ", ctrlKey: true");
      const atEnd = await page.waitFor(
        `(document.querySelector('.parquet-viewer__pager-info')?.innerText ?? '') === '251–300 of 300'`,
        5000,
      );
      expect(atEnd, "Ctrl+End did not reach the last page");
      await press("Home", ", ctrlKey: true");
      const atStart = await page.waitFor(
        `(document.querySelector('.parquet-viewer__pager-info')?.innerText ?? '') === '1–50 of 300'`,
        5000,
      );
      expect(atStart, "Ctrl+Home did not return to the first page");
      // After a long jump the cursor is restored from the newly loaded page, not the old one.
      const home = await page.waitFor(
        `(() => {
                const label = (document.querySelector('.parquet-viewer__selection-label')?.innerText ?? '').trim();
                const value = (document.querySelector('.parquet-viewer__selection-value')?.innerText ?? '').trim();
                const first = ${firstRow};
                return /id · row 1\\b/.test(label) && value === first && first === '1';
            })()`,
        5000,
      );
      expect(
        home,
        `the inspector kept a value from the previous page: ${JSON.stringify(await selection())}`,
      );
      return "PageDown/PageUp, page-edge arrows and Ctrl+Home/End keep the cursor";
    },
  },
  {
    name: "parquet-inspector",
    docs: "parquet-inspector.png",
    async run({ page, base }) {
      await openParquet(page, base, "?mixed=1");
      const hint = await page.evaluate(
        `document.querySelector('.parquet-viewer__selection-hint')?.innerText ?? null`,
      );
      expect(hint === "Select a cell to inspect it", `selection hint: ${hint}`);
      await page.evaluate(`(() => {
                const cell = ${firstRowCell(2)}.querySelector('.parquet-viewer__cell');
                cell.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            })()`);
      const inspected = await page.waitFor(
        `/name · row 1/.test(document.querySelector('.parquet-viewer__selection-label')?.innerText ?? '')`,
      );
      expect(inspected, "selection never showed name · row 1");
      const state = json(
        await page.evaluate(`JSON.stringify({
                label: document.querySelector('.parquet-viewer__selection-label')?.innerText ?? null,
                value: document.querySelector('.parquet-viewer__selection-value')?.innerText ?? null,
            })`),
      );
      expect(/name · row 1/.test(state.label ?? ""), `unexpected selection label: ${state.label}`);
      expect((state.value ?? "").length > 0, "selection showed no value");

      // The visible bar updates on every arrow key, so an aria-live on it queued one
      // announcement per keystroke. Assistive tech now hears the selection once it settles.
      const liveOnBar = await page.evaluate(
        `document.querySelector('.parquet-viewer__selection')?.getAttribute('aria-live') ?? null`,
      );
      expect(liveOnBar === null, `the visible bar is still a live region (${liveOnBar})`);
      const announceSelector = `(document.querySelector('.parquet-viewer__bottombar [role="status"]')?.textContent ?? '')`;
      const announcedName = await page.waitFor(`${announceSelector}.includes('name')`, 4000);
      expect(announcedName, "a settled selection was never announced");
      // Pick another cell: the region has to keep the old text until the new one settles.
      await page.evaluate(`(() => {
                const cell = ${firstRowCell(3)}.querySelector('.parquet-viewer__cell');
                cell.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            })()`);
      const during = await page.evaluate(announceSelector);
      expect(
        during.includes("name"),
        `the live region updated on the click instead of settling: ${during}`,
      );
      const announcedNext = await page.waitFor(`${announceSelector}.includes('active')`, 4000);
      expect(
        announcedNext,
        `the new selection was never announced: ${await page.evaluate(announceSelector)}`,
      );

      // The selected value lives inside the bottom bar; there is no extra full-width row
      // between the table and the footer.
      const layout = json(
        await page.evaluate(`JSON.stringify({
                insideFooter: !!document.querySelector('.parquet-viewer__bottombar .parquet-viewer__selection'),
                extraRow: !!document.querySelector('.parquet-viewer__inspector-slot, .parquet-viewer__inspector'),
                tableBodyBottom: document.querySelector('.parquet-viewer__table-wrap')?.getBoundingClientRect().bottom ?? -1,
                footerTop: document.querySelector('.parquet-viewer__bottombar')?.getBoundingClientRect().top ?? -1,
            })`),
      );
      expect(layout.tableBodyBottom > 0, "table body not found");
      expect(layout.insideFooter, "selection is not inside the bottom bar");
      expect(!layout.extraRow, "a separate inspector row came back");
      expect(
        layout.tableBodyBottom <= layout.footerTop + 1,
        `table body overlaps the bottom bar: ${layout.tableBodyBottom} > ${layout.footerTop}`,
      );

      // The selection is one group. It used to stretch, which dragged its own copy/close buttons
      // to the far end of the bar, right up against the pager; the distance between the group's
      // right edge and the pager is what tells the two layouts apart.
      const grouping = json(
        await page.evaluate(`JSON.stringify((() => {
                const group = document.querySelector('.parquet-viewer__selection')?.getBoundingClientRect();
                const pager = document.querySelector('.parquet-viewer__pager')?.getBoundingClientRect();
                const copy = document.querySelector('[aria-label="Copy value"]')?.getBoundingClientRect();
                const value = document.querySelector('.parquet-viewer__selection-value')?.getBoundingClientRect();
                if (!group || !pager || !copy || !value) return { groupToPager: null, copyToValue: null };
                return {
                    groupToPager: Math.round(pager.left - group.right),
                    copyToValue: Math.round(copy.left - value.right),
                };
            })())`),
      );
      expect(
        typeof grouping.groupToPager === "number" && grouping.groupToPager > 80,
        `the selection group is stretched to the pager (${grouping.groupToPager}px apart)`,
      );
      expect(
        typeof grouping.copyToValue === "number" && grouping.copyToValue < 40,
        `copy button sits ${grouping.copyToValue}px from the value`,
      );

      // A container is previewed, not dumped: the same 320-character cap the cells use.
      await openParquet(page, base, "?preview=1");
      await page.evaluate(`(() => {
                const cell = [...document.querySelectorAll('.parquet-viewer__cell--json')][0];
                cell.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            })()`);
      const previewed = await page.waitFor(
        `/meta_json|tags_json/.test(document.querySelector('.parquet-viewer__selection-label')?.innerText ?? '')`,
        5000,
      );
      expect(previewed, "a JSON cell never reached the inspector");
      const capped = json(
        await page.evaluate(`JSON.stringify({
                shown: document.querySelector('.parquet-viewer__selection-value')?.innerText ?? '',
                full: document.querySelector('.parquet-viewer__selection-value')?.getAttribute('title') ?? '',
            })`),
      );
      expect(capped.shown.length <= 340, `the inspector dumped ${capped.shown.length} chars`);
      expect(
        capped.full.length >= capped.shown.length,
        "the title no longer carries the full value for copying",
      );

      // Clicking a link opens it *and* selects it: the one value a reader most wants to copy
      // must not be the only one the inspector can never hold.
      await page.evaluate(`(() => {
                const link = document.querySelector('.parquet-viewer__cell-link');
                link?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            })()`);
      const linked = await page.waitFor(
        `/url/.test(document.querySelector('.parquet-viewer__selection-label')?.innerText ?? '')`,
        5000,
      );
      expect(linked, "clicking a link did not put it in the inspector");
      const opened = await page.evaluate(`(window.__openExternalCalls ?? []).length`);
      expect(opened > 0, "the link click stopped opening the link");

      // End on the state this scenario documents: the four-column fixture with a plain cell
      // selected, not the twelve-column link fixture it just finished with.
      await openParquet(page, base, "?mixed=1");
      await page.evaluate(`(() => {
                const cell = ${firstRowCell(2)}.querySelector('.parquet-viewer__cell');
                cell.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            })()`);
      const restored = await page.waitFor(
        `/name · row 1/.test(document.querySelector('.parquet-viewer__selection-label')?.innerText ?? '')`,
        5000,
      );
      expect(restored, "the documented state did not come back");

      return `${state.label} = ${state.value}`;
    },
  },
  {
    name: "parquet-inspector-clears",
    async run({ page, base }) {
      await openParquet(page, base, "?mixed=1");
      await page.evaluate(`(() => {
                const cell = ${firstRowCell(2)}.querySelector('.parquet-viewer__cell');
                cell.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            })()`);
      const inspected = await page.waitFor(
        `/name · row 1/.test(document.querySelector('.parquet-viewer__selection-label')?.innerText ?? '')`,
      );
      expect(inspected, "selection never opened before the page change");
      await clickNextPage(page);
      const cleared = await page.evaluate(
        `!!document.querySelector('.parquet-viewer__selection-hint') && !document.querySelector('.parquet-viewer__selection-value')`,
      );
      expect(cleared, "selection survived a page change");
      return "selection cleared on page change";
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
            // The first arrow lands on the first cell, so reaching name·row 2 takes two rights.
            press('ArrowRight');
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
        `/name · row 2/.test(document.querySelector('.parquet-viewer__selection-label')?.innerText ?? '')`,
      );
      expect(inspected, "Enter did not select the cursor cell (name · row 2)");
      // The in-bar selection must not reflow the grid.
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
      return "bool split + keyboard cursor + in-bar selection + target row";
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
        `document.querySelector('.parquet-viewer__find-count')?.innerText === '1 of 1'`,
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
      expect(state.count === "1 of 1", `unexpected match count: ${state.count}`);
      expect(state.hits > 0, "matched cell was not highlighted");
      expect(state.rows === 1, `expected 1 marked row, got ${state.rows}`);
      expect(state.range === "51–100 of 300", `did not jump to the match page: ${state.range}`);
      // A hit must not look like a schema click: the column scrolls into view, but the tint
      // that means "you picked this field" stays off.
      const sloppy = await page.evaluate(
        `document.querySelectorAll('.parquet-viewer__column--active').length`,
      );
      expect(sloppy === 0, `a search left ${sloppy} schema-selected column(s)`);
      // Geometry that only exists when the row-level rules reach the virtual body. The body
      // renders div `.ant-table-cell`s, so a `tr > td` rule is silently dead there: stripes,
      // the 6px cell padding and the match tint all vanished without a single failing test.
      const geometry = json(
        await page.evaluate(`JSON.stringify((() => {
                const rows = [...document.querySelectorAll('.ant-table-tbody-virtual-holder-inner > *')];
                // Composite alpha: a tint that resolves to rgba(…, 0.06) is invisible even when
                // its raw channels look far from the background.
                const nums = (value) => (value.match(/[\\d.]+/g) ?? []).map(Number);
                const composite = (fg, under) => {
                    const alpha = fg.length > 3 ? fg[3] : 1;
                    return [0, 1, 2].map((i) => Math.round(fg[i] * alpha + under[i] * (1 - alpha)));
                };
                const bg = (row) => {
                    const cell = row ? (row.querySelector('.ant-table-cell') ?? row) : null;
                    if (!cell) return null;
                    const fg = nums(getComputedStyle(cell).backgroundColor);
                    if (fg.length < 3) return null;
                    let node = cell.parentElement;
                    let under = null;
                    while (node) {
                        const candidate = nums(getComputedStyle(node).backgroundColor);
                        if (candidate.length >= 3 && (candidate.length === 3 || candidate[3] >= 0.5)) {
                            under = candidate.slice(0, 3);
                            break;
                        }
                        node = node.parentElement;
                    }
                    return composite(fg, under ?? [255, 255, 255]);
                };
                const base = rows.find((row) => !/row--(alt|match|target)/.test(row.className));
                const alt = rows.find((row) => /row--alt/.test(row.className));
                const match = document.querySelector('.parquet-viewer__row--match');
                const cell = document.querySelector('.ant-table-tbody-virtual .ant-table-cell');
                const style = cell ? getComputedStyle(cell) : null;
                return {
                    rows: rows.length,
                    height: rows[0] ? rows[0].getBoundingClientRect().height : 0,
                    border: style ? style.borderBottomWidth : null,
                    padding: style ? style.paddingTop : null,
                    base: bg(base), alt: bg(alt), match: bg(match),
                };
            })())`),
      );
      expect(geometry.rows > 0, "the virtual body rendered no rows");
      expect(geometry.height >= 33 && geometry.height <= 35, `row height: ${geometry.height}px`);
      expect(geometry.border === "0px", `row separators came back: ${geometry.border}`);
      expect(geometry.padding === "6px", `cell padding: ${geometry.padding}`);
      expect(
        geometry.alt && geometry.base && geometry.alt !== geometry.base,
        "alternate rows are not tinted",
      );
      expect(
        geometry.match && geometry.base && geometry.match !== geometry.base,
        "the matched row has no tint",
      );
      // The tint's *strength* is not gated: measuring it means resolving antd's layered
      // backgrounds, and the walk-up produced [0,0,0] for the matched row — an unreliable number
      // is worse than none. The colour is chosen for legibility and checked in the screenshot;
      // only the fact that the row is tinted differently is asserted above.
      // Enter follows VS Code's own find: it walks the hits. Re-running the scan is Ctrl+Enter
      // and the button, so a multi-hit query gives the semantics something to observe.
      await page.evaluate(`(() => {
                const input = document.querySelector('.parquet-viewer__find-input');
                const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                setter.call(input, 'service-');
                input.dispatchEvent(new Event('input', { bubbles: true }));
                document.querySelector('.parquet-viewer__find-btn')
                    .dispatchEvent(new MouseEvent('click', { bubbles: true }));
            })()`);
      const many = await page.waitFor(
        `/^1 of 300$/.test((document.querySelector('.parquet-viewer__find-count')?.innerText ?? '').trim())`,
        15000,
      );
      expect(many, "a multi-hit scan did not report its position");
      const before = (await pagerState(page)).range;
      await page.evaluate(`(() => {
                const input = document.querySelector('.parquet-viewer__find-input');
                input.focus();
                input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
            })()`);
      const stepped = await page.waitFor(
        `(document.querySelector('.parquet-viewer__pager-info')?.innerText ?? '') !== ${JSON.stringify(before)}`,
        15000,
      );
      expect(stepped, `Enter did not step to the next hit (still ${before})`);
      // "N of M" has to move with the jump: a bare total left the reader guessing where they were.
      const position = await page.evaluate(
        `(document.querySelector('.parquet-viewer__find-count')?.innerText ?? '').trim()`,
      );
      expect(
        /^\d+ of 300$/.test(position) && position !== "1 of 300",
        `the match position did not advance: ${position}`,
      );
      // A scan that finds nothing is an answer, and the bar has to say so: previously the
      // whole state block was gated on `matchRows.size > 0`, so zero hits looked identical
      // to "you never searched".
      await page.evaluate(`(() => {
                const input = document.querySelector('.parquet-viewer__find-input');
                const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                setter.call(input, 'no-such-value-anywhere');
                input.dispatchEvent(new Event('input', { bubbles: true }));
                document.querySelector('.parquet-viewer__find-btn')
                    .dispatchEvent(new MouseEvent('click', { bubbles: true }));
            })()`);
      const nothing = await page.waitFor(
        `(document.querySelector('.parquet-viewer__find-count')?.innerText ?? '') === '0 matches'`,
        15000,
      );
      expect(nothing, "a scan with no hits left the bar blank");
      const stillMarked = await page.evaluate(
        `document.querySelectorAll('.parquet-viewer__row--match').length`,
      );
      expect(stillMarked === 0, `${stillMarked} row(s) stayed marked after an empty scan`);
      // Editing the text invalidates the result set: a count that no longer matches the box is a
      // lie, and Enter used to act on it — jumping to a hit of the previous needle.
      await page.evaluate(`(() => {
                const input = document.querySelector('.parquet-viewer__find-input');
                const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                setter.call(input, 'service-c-54x');
                input.dispatchEvent(new Event('input', { bubbles: true }));
            })()`);
      const cleared = await page.waitFor(
        `!/\\d+ of \\d+/.test(document.querySelector('.parquet-viewer__find-count')?.innerText ?? '')`,
        4000,
      );
      expect(cleared, "the old match count survived a new query");
      const hint = await page.evaluate(
        `(document.querySelector('.parquet-viewer__find-count')?.innerText ?? '').trim()`,
      );
      expect(
        /Press Enter/.test(hint),
        `a query with no results yet should say what Enter does, not "${hint}"`,
      );
      const stale = await page.evaluate(
        `document.querySelectorAll('.parquet-viewer__row--match').length`,
      );
      expect(stale === 0, `${stale} row(s) stayed marked for the old query`);
      await page.evaluate(`(() => {
                const input = document.querySelector('.parquet-viewer__find-input');
                input.focus();
                input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
            })()`);
      const reSearched = await page.waitFor(
        `(document.querySelector('.parquet-viewer__find-count')?.innerText ?? '') === '0 matches'`,
        15000,
      );
      expect(reSearched, "Enter did not search the edited text");
      // End on a hit: this scenario also produces the documentation screenshot, and a picture
      // of "0 matches" is not what the README is trying to show.
      await page.evaluate(`(() => {
                const input = document.querySelector('.parquet-viewer__find-input');
                const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                setter.call(input, 'service-c-54');
                input.dispatchEvent(new Event('input', { bubbles: true }));
                document.querySelector('.parquet-viewer__find-btn')
                    .dispatchEvent(new MouseEvent('click', { bubbles: true }));
            })()`);
      const again = await page.waitFor(
        `document.querySelector('.parquet-viewer__find-count')?.innerText === '1 of 1'`,
        15000,
      );
      expect(again, "re-running the first query did not restore its hit");
      return `${state.count} at ${state.range}, ${geometry.height}px rows, Enter steps past ${before}, empty scan says 0`;
    },
  },
  {
    name: "excel-large-file-guard",
    docs: "excel-too-large.png",
    async run({ page, base }) {
      // The stub claims 900 MB; the guard has to refuse before fetching anything, so the
      // grid must not be there and the panel must name the file and the limit.
      await page.navigate(`${base}/harness-route?route=excel&guard=1`);
      const panel = await page.waitFor(`!!document.querySelector('.excel-too-large')`, 15000);
      expect(panel, "the size guard did not render for an oversized file");
      const state = json(
        await page.evaluate(`JSON.stringify({
                text: document.querySelector('.excel-too-large')?.innerText ?? '',
                grid: !!document.querySelector('#container .x-spreadsheet'),
                buttons: [...document.querySelectorAll('.excel-too-large button')].map(b => b.textContent.trim()),
            })`),
      );
      expect(/huge\.csv/.test(state.text), `panel does not name the file: ${state.text}`);
      expect(/900\.0 MB/.test(state.text), `panel does not show the file size: ${state.text}`);
      expect(/200\.0 MB/.test(state.text), `panel does not show the limit: ${state.text}`);
      expect(!state.grid, "the grid rendered anyway — the guard must not parse the file");
      expect(
        state.buttons.includes("Open anyway"),
        `missing the retry button: ${state.buttons.join(" / ")}`,
      );

      // Answering "open anyway" really does load it.
      await page.evaluate(`[...document.querySelectorAll('.excel-too-large button')]
                .find(b => b.textContent.trim() === 'Open anyway')?.click()`);
      const grid = await page.waitFor(
        `!!document.querySelector('#container .x-spreadsheet')`,
        15000,
      );
      expect(grid, "the viewer never loaded the file after confirming");
      const cells = await page.evaluate(
        `document.querySelectorAll('#container .x-spreadsheet').length`,
      );
      expect(
        await page.evaluate(`!document.querySelector('.excel-too-large')`),
        "the guard stayed up",
      );
      return `refused 900 MB, loaded after confirm (${cells} grid)`;
    },
  },
  {
    name: "parquet-large-virtual-guard",
    async run({ page, base }) {
      // A virtual document over the limit: the host sends no bytes, only the refusal.
      await page.navigate(`${base}/harness-parquet?guard=1`);
      const panel = await page.waitFor(
        `!!document.querySelector('.parquet-viewer__too-large')`,
        15000,
      );
      expect(panel, "the parquet size guard did not render");
      const state = json(
        await page.evaluate(`JSON.stringify({
                text: document.querySelector('.parquet-viewer__too-large')?.innerText ?? '',
                table: !!document.querySelector('.parquet-viewer__cell'),
            })`),
      );
      expect(/big-virtual\.parquet/.test(state.text), `does not name the file: ${state.text}`);
      expect(/80\.0 MB/.test(state.text), `does not show the size: ${state.text}`);
      expect(/50\.0 MB/.test(state.text), `does not show the limit: ${state.text}`);
      expect(!state.table, "the table rendered — nothing should have been loaded");

      await page.evaluate(
        `document.querySelector('.parquet-viewer__too-large-open')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))`,
      );
      const loaded = await page.waitFor(
        `(document.querySelector('.parquet-viewer__pager-info')?.innerText ?? '').includes('1–50 of 300')`,
        15000,
      );
      expect(loaded, "the viewer never loaded the document after confirming");
      return "refused 80 MB virtual parquet, loaded after confirm";
    },
  },
  {
    name: "excel-windowed-large-file",
    docs: "excel-windowed.png",
    async run({ page, base }) {
      // 12 MB of CSV: above the 8 MB window threshold, below the size guard. The editable grid
      // would build 5000 x 8 cell objects; the windowed view renders only the viewport.
      await page.navigate(`${base}/harness-route?route=excel&window=1`);
      const ready = await page.waitFor(`!!document.querySelector('.windowed-sheet__row')`, 15000);
      expect(ready, "the windowed view did not render");
      const state = json(
        await page.evaluate(`JSON.stringify({
                grid: !!document.querySelector('#container .x-spreadsheet'),
                rows: document.querySelectorAll('.windowed-sheet__row').length,
                total: Number(document.querySelector('.windowed-sheet')?.dataset.rows ?? 0),
                banner: document.querySelector('.windowed-sheet__banner')?.innerText ?? '',
                first: document.querySelector('.windowed-sheet__row .windowed-sheet__cell')?.innerText ?? '',
            })`),
      );
      expect(!state.grid, "the editable grid mounted for a large file");
      // The served file is a header row plus 5000 data rows; the window shows every record,
      // like the grid does, so the header is row 1.
      expect(state.total === 5001, `unexpected row count: ${state.total}`);
      expect(state.rows > 0 && state.rows < 80, `rendered ${state.rows} rows, expected a viewport`);
      expect(/Read-only/.test(state.banner), `missing the read-only banner: ${state.banner}`);
      expect(state.first === "id", `unexpected first cell: ${state.first}`);

      await page.evaluate(`(() => {
                const scroller = document.querySelector('.windowed-sheet__scroller');
                scroller.scrollTop = scroller.scrollHeight;
                scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
            })()`);
      const reachedEnd = await page.waitFor(
        `[...document.querySelectorAll('.windowed-sheet__cell')].some(cell => cell.textContent === 'r4999')`,
        15000,
      );
      expect(reachedEnd, "scrolling to the end never rendered the last row");
      return `5001 records, ${state.rows} rows in the DOM, last row reachable`;
    },
  },
  {
    name: "excel-windowed-find",
    docs: "excel-windowed-find.png",
    async run({ page, base }) {
      // Phase 3: the windowed view has no cell model, so find scans row blocks from the source
      // and "go to row" only moves the scroll offset. Both must land on real rows.
      await page.navigate(`${base}/harness-route?route=excel&window=1`);
      const ready = await page.waitFor(`!!document.querySelector('.windowed-sheet__row')`, 15000);
      expect(ready, "the windowed view did not render");

      await page.evaluate(`(() => {
                const input = document.querySelectorAll('.windowed-sheet__input')[0];
                const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                setter.call(input, 'r4999');
                input.dispatchEvent(new Event('input', { bubbles: true }));
                [...document.querySelectorAll('.windowed-sheet__btn')]
                    .find(b => b.textContent.trim() === 'Find')?.click();
            })()`);
      const found = await page.waitFor(
        `(() => {
                    const count = document.querySelector('.windowed-sheet__count')?.innerText ?? '';
                    const cells = [...document.querySelectorAll('.windowed-sheet__cell')];
                    return /1 match/.test(count) && cells.some(cell => cell.textContent === 'r4999');
                })()`,
        20000,
      );
      expect(found, "find did not report and jump to the single match");
      const state = json(
        await page.evaluate(`JSON.stringify({
                count: document.querySelector('.windowed-sheet__count')?.innerText ?? '',
                marks: document.querySelectorAll('.windowed-sheet__hit').length,
                matchedRows: document.querySelectorAll('.windowed-sheet__row--match').length,
                targeted: [...document.querySelectorAll('.windowed-sheet__row--target .windowed-sheet__cell')]
                    .map(cell => cell.textContent).slice(0, 2),
            })`),
      );
      expect(state.marks > 0, "the matched cell was not highlighted");
      expect(state.matchedRows === 1, `expected 1 marked row, got ${state.matchedRows}`);
      expect(state.targeted.includes("r4999"), `target row: ${state.targeted.join(",")}`);

      await page.evaluate(`(() => {
                const input = document.querySelectorAll('.windowed-sheet__input--row')[0];
                const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                setter.call(input, '3000');
                input.dispatchEvent(new Event('input', { bubbles: true }));
                [...document.querySelectorAll('.windowed-sheet__btn')]
                    .find(b => b.textContent.trim() === 'Go')?.click();
            })()`);
      const jumped = await page.waitFor(
        `[...document.querySelectorAll('.windowed-sheet__cell')].some(cell => cell.textContent === 'r2999')`,
        15000,
      );
      expect(jumped, "go-to-row never scrolled to row 3000");
      return `find: ${state.count}, ${state.marks} mark(s); jump: row 3000 visible`;
    },
  },
  {
    name: "excel-windowed-workbook",
    docs: "excel-windowed-workbook.png",
    async run({ page, base }) {
      // Phase 4: a workbook is parsed whole (zip is not seekable) but into row text, then
      // rendered by the same windowed view. Two sheets prove the picker switches slices.
      await page.navigate(`${base}/harness-route?route=excel&workbook=1`);
      const ready = await page.waitFor(`!!document.querySelector('.windowed-sheet__row')`, 20000);
      expect(ready, "the windowed workbook did not render");
      const state = json(
        await page.evaluate(`JSON.stringify({
                grid: !!document.querySelector('#container .x-spreadsheet'),
                rows: document.querySelectorAll('.windowed-sheet__row').length,
                total: Number(document.querySelector('.windowed-sheet')?.dataset.rows ?? 0),
                sheets: [...document.querySelectorAll('.windowed-sheet__select option')].map(o => o.textContent),
                first: document.querySelector('.windowed-sheet__row .windowed-sheet__cell')?.innerText ?? '',
            })`),
      );
      expect(!state.grid, "the editable grid mounted for a workbook");
      expect(state.total === 201, `unexpected row count: ${state.total}`);
      expect(state.rows > 0 && state.rows < 80, `rendered ${state.rows} rows`);
      expect(state.first === "id", `unexpected first cell: ${state.first}`);
      expect(state.sheets.join(",") === "Data,Extra", `sheet picker: ${state.sheets.join(",")}`);

      await page.evaluate(`(() => {
                const select = document.querySelector('.windowed-sheet__select');
                const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
                setter.call(select, '1');
                select.dispatchEvent(new Event('change', { bubbles: true }));
            })()`);
      const switched = await page.waitFor(
        `document.querySelector('.windowed-sheet__row .windowed-sheet__cell')?.innerText === 'a'`,
        15000,
      );
      expect(switched, "switching sheets did not show the second sheet");
      const total = await page.evaluate(
        `Number(document.querySelector('.windowed-sheet')?.dataset.rows ?? 0)`,
      );
      expect(total === 3, `second sheet has ${total} rows`);
      return "201-row workbook windowed, sheet switch works";
    },
  },
  {
    name: "excel-windowed-legacy",
    async run({ page, base }) {
      // `.xls` is decoded by SheetJS rather than ExcelJS; the window contract must be the same.
      await page.navigate(`${base}/harness-route?route=excel&legacy=1`);
      const ready = await page.waitFor(`!!document.querySelector('.windowed-sheet__row')`, 20000);
      expect(ready, "the windowed .xls did not render");
      const state = json(
        await page.evaluate(`JSON.stringify({
                grid: !!document.querySelector('#container .x-spreadsheet'),
                total: Number(document.querySelector('.windowed-sheet')?.dataset.rows ?? 0),
                rows: document.querySelectorAll('.windowed-sheet__row').length,
                first: document.querySelector('.windowed-sheet__row .windowed-sheet__cell')?.innerText ?? '',
                second: [...document.querySelectorAll('.windowed-sheet__row')][1]
                    ?.querySelectorAll('.windowed-sheet__cell')[1]?.innerText ?? '',
            })`),
      );
      expect(!state.grid, "the editable grid mounted for a legacy workbook");
      expect(state.total === 51, `unexpected row count: ${state.total}`);
      expect(state.rows > 0 && state.rows < 80, `rendered ${state.rows} rows`);
      expect(state.first === "id", `unexpected first cell: ${state.first}`);
      expect(state.second === "legacy-0", `unexpected second row: ${state.second}`);
      return `51-row .xls windowed through SheetJS`;
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
      // The prefetch is idle-scheduled now (it used to start in the same tick as the visible
      // page and delay it), so give the idle callback a chance before asserting on it.
      await page.sleep(300);
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
