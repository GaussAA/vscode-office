/**
 * Shared helpers for the UI scenarios: mounting a viewer on the harness, reading the pager,
 * measuring contrast. Extracted from the runner so a scenario module only says what it asserts.
 */
export function expect(condition, message) {
  if (!condition) throw new Error(message);
}

export const json = (value) => JSON.parse(value);

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
export const expectedProbe = /evaluating a string as JavaScript/i;
export const unexpected = (list) => list.filter((text) => !expectedProbe.test(text));

export async function openJsonl(page, base, theme = "dark", query = "") {
  // JSONL restores the selected entry per document. Scenarios share one profile, so
  // without clearing it the next scenario could start on L11 (too-large) instead of L1.
  await page.navigate(`${base}/stats`);
  await page.evaluate(`Object.keys(localStorage)
        .filter(key => key.startsWith('jsonl-state:'))
        .forEach(key => localStorage.removeItem(key))`);
  await page.navigate(`${base}/harness?theme=${theme}${query}`);
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

export async function openEmptyJsonl(page, base) {
  await page.navigate(`${base}/stats`);
  await page.evaluate(`Object.keys(localStorage)
        .filter(key => key.startsWith('jsonl-state:'))
        .forEach(key => localStorage.removeItem(key))`);
  await page.navigate(`${base}/harness?empty=1`);
  const ready = await page.waitFor(`!!document.querySelector('.jsonl-empty--viewer')`);
  expect(ready, "empty JSONL file did not render its empty state");
}

export async function jumpJsonl(page, entry) {
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

export async function openParquet(page, base, query = "") {
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
export const ROWS = "[...document.querySelectorAll('.parquet-table .ant-table-row')]";
/** A cell of the first data row by column position (index column included). */
export const firstRowCell = (column) => `(${ROWS}[0])?.children[${column}]`;

export const pagerState = (page) =>
  page
    .evaluate(`JSON.stringify({
    range: document.querySelector('.parquet-viewer__pager-info')?.innerText ?? null,
    first: (${ROWS}[0])?.children[0]?.innerText ?? null,
})`)
    .then(json);

/**
 * Rows per page, as the viewer computed it.
 *
 * A page is one screenful, so the number depends on the viewport and cannot be written into an
 * assertion. The viewer publishes it as `data-page-size` on the grid.
 */
export const pageSize = async (page) => {
  const value = await page.evaluate(
    `Number(document.querySelector('.parquet-viewer__table-wrap')?.dataset.pageSize ?? 0)`,
  );
  return value > 0 ? value : 50;
};

/** The pager's row range for `index`, given a page size. */
export const rangeOf = (size, index, total) =>
  `${(index * size + 1).toLocaleString()}–${Math.min(total, (index + 1) * size).toLocaleString()} of ${total.toLocaleString()}`;

/** Perceived luminance (0..1) of an element's background, or null when it has none. */
export const luminance = (page, selector) =>
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
export const contrastRatio = (page, selector) =>
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

export async function clickNextPage(page) {
  const before = (await pagerState(page)).range;
  await page.evaluate(`[...document.querySelectorAll('.parquet-viewer__pager-btn')]
        .filter(b => b.getAttribute('aria-label') === 'Next page')[0]
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
  const moved = await page.waitFor(
    `(document.querySelector('.parquet-viewer__pager-info')?.innerText ?? '') !== ${JSON.stringify(before)}`,
  );
  expect(moved, `pager stayed on ${before}`);
}
/**
 * Mount the command-opened JSON preview stub. `mode` is the harness `?mode=` selector:
 * array (default), object, invalid, too-large, empty.
 */
export async function openJson(page, base, mode = "array", query = "") {
  await page.navigate(`${base}/stats`);
  await page.evaluate(`Object.keys(localStorage)
        .filter(key => key.startsWith('json-preview:left:'))
        .forEach(key => localStorage.removeItem(key))`);
  await page.navigate(`${base}/harness-json?theme=dark&mode=${mode}${query}`);
  // Do not accept the bare loading state: `.json-preview__state` exists before `jsonInfo`
  // arrives. A record, a titled terminal state, or an object-root tree means data landed.
  const ready = await page.waitFor(`!!document.querySelector(
        '.json-record, .json-preview__state-title, .jsonl-detail__tree, .jsonl-detail__scalar'
    )`);
  if (!ready) {
    const diagnostic = await page.evaluate(`JSON.stringify({
      url: location.href,
      bodyText: (document.body?.innerText ?? "").slice(0, 200).replace(/\\s+/g, " "),
      records: document.querySelectorAll(".json-record").length,
      state: document.querySelectorAll(".json-preview__state").length,
      tree: document.querySelectorAll(".jsonl-detail__tree").length,
    })`);
    expect(false, `JSON preview did not render: ${diagnostic}`);
  }
}

/** Set an input the way React sees it. */
export function setInput(selector, value) {
  return `(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    input.focus();
    setter.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`;
}
