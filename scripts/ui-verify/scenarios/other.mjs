import {
  clickNextPage,
  contrastRatio,
  expect,
  json,
  jumpJsonl,
  openJsonl,
  openParquet,
  pageSize,
  pagerState,
  rangeOf,
} from "../helpers.mjs";

/** 3 scenario(s); the runner concatenates these lists. */
export default [
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
      // The selected column is a reading surface too: its tint sits behind the same green
      // STRING / orange BOOL / blue NUMERIC text. Measure each while its column is active;
      // the light-theme mix is capped so those cells stay at 4.5:1.
      for (const [key, field, selector] of [
        ["activeString", "name", ".parquet-viewer__column--active .parquet-viewer__cell--string"],
        [
          "activeBool",
          "active",
          ".parquet-viewer__column--active .parquet-viewer__cell--bool-true",
        ],
        [
          "activeNumeric",
          "score",
          ".parquet-viewer__column--active .parquet-viewer__cell--numeric",
        ],
      ]) {
        await page.evaluate(`(() => {
            const item = [...document.querySelectorAll('.parquet-viewer__list-item')]
                .find(button => button.querySelector('.parquet-viewer__list-name')?.textContent === ${JSON.stringify(field)});
            item?.click();
        })()`);
        await page.sleep(250);
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
      // The URL column is the widest use of the selected tint: a link cell keeps its Signal
      // Blue on the 14% wash, so measure it with the column active too.
      await page.evaluate(`(() => {
          const item = [...document.querySelectorAll('.parquet-viewer__list-item')]
              .find(button => button.querySelector('.parquet-viewer__list-name')?.textContent === 'url');
          item?.click();
      })()`);
      await page.sleep(350);
      parquet.activeLink = await contrastRatio(
        page,
        ".parquet-viewer__column--active .parquet-viewer__cell--link a",
      );
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
      // The selection panel is a reading surface too: its path, preview and count are text
      // the user has to read, not chrome that can fall below AA.
      await jumpJsonl(page, 14);
      await page.evaluate(`(() => {
                const row = [...document.querySelectorAll('.jsonl-detail__tree .ant-tree-treenode')]
                    .find(node => node.innerText.startsWith('longValue'));
                row?.querySelector('.ant-tree-node-content-wrapper')
                    ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            })()`);
      await page.waitFor(`!!document.querySelector('.jsonl-valuebar__toggle')`);
      await page.evaluate(`document.querySelector('.jsonl-valuebar__toggle')?.click()`);
      await page.waitFor(`!!document.querySelector('.jsonl-valuebar__text')`);
      for (const [key, selector] of [
        ["panelPath", ".jsonl-valuebar__path"],
        ["panelPreview", ".jsonl-valuebar__preview"],
        ["panelCount", ".jsonl-valuebar__count"],
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
                buttons: [...document.querySelectorAll('.parquet-viewer__too-large button')]
                    .map(b => b.textContent.trim()),
            })`),
      );
      expect(/big-virtual\.parquet/.test(state.text), `does not name the file: ${state.text}`);
      expect(/80\.0 MB/.test(state.text), `does not show the size: ${state.text}`);
      expect(/50\.0 MB/.test(state.text), `does not show the limit: ${state.text}`);
      expect(!state.table, "the table rendered — nothing should have been loaded");
      // "Open anyway" is a memory bet; the file is on disk either way, so there is a second
      // exit that costs nothing.
      expect(
        state.buttons.includes("Open anyway") && state.buttons.includes("Reveal in Explorer"),
        `the guard has no cost-free exit: ${state.buttons.join(" / ")}`,
      );

      await page.evaluate(
        `document.querySelector('.parquet-viewer__too-large-open')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))`,
      );
      // The page size only exists once the grid has measured itself, so wait for the table
      // before computing the expected range.
      await page.waitFor(
        `!!document.querySelector('.parquet-viewer__table-wrap[data-page-size]')`,
        15000,
      );
      const size = await pageSize(page);
      const loaded = await page.waitFor(
        `(document.querySelector('.parquet-viewer__pager-info')?.innerText ?? '').includes(${JSON.stringify(rangeOf(size, 0, 300))})`,
        15000,
      );
      expect(loaded, "the viewer never loaded the document after confirming");
      return "refused 80 MB virtual parquet, loaded after confirm";
    },
  },
  {
    name: "parquet-prefetch",
    async run({ page, base, stats }) {
      await openParquet(page, base, "?mixed=1");
      const size = await pageSize(page);
      // The prefetch is idle-scheduled now (it used to start in the same tick as the visible
      // page and delay it), so give the idle callback a chance before asserting on it.
      await page.sleep(300);
      const before = await stats();
      await clickNextPage(page);
      const after = await stats();
      const delta = after.ranged - before.ranged;
      expect(delta === 0, `page 2 needed ${delta} extra range requests (prefetch is broken)`);
      const state = await pagerState(page);
      expect(state.range === rangeOf(size, 1, 300), `page 2 did not render: ${state.range}`);
      return `next page served from cache (0 extra reads)`;
    },
  },
];
