import {
  ROWS,
  clickNextPage,
  contrastRatio,
  expect,
  firstRowCell,
  json,
  jumpJsonl,
  luminance,
  openEmptyJsonl,
  openJsonl,
  openParquet,
  pageSize,
  pagerState,
  rangeOf,
  unexpected,
} from "../helpers.mjs";

/** 9 scenario(s); the runner concatenates these lists. */
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
      const routes = ["excel"];
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
