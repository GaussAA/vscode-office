import {
  ROWS,
  clickNextPage,
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

/** 12 scenario(s); the runner concatenates these lists. */
export default [
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
                    // The filler column that absorbs leftover width is not a column of the
                    // file: it carries no aria-colindex and is hidden from assistive tech.
                    headerRoles: [...new Set(header
                        .filter(th => th.getAttribute('aria-colindex'))
                        .map(th => th.getAttribute('role')))],
                    headerCols: header
                        .map(th => th.getAttribute('aria-colindex'))
                        .filter(Boolean),
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
      const size = await pageSize(page);
      await clickNextPage(page);
      const second = await pagerState(page);
      expect(second.range === rangeOf(size, 1, 300), `page 2 range: ${second.range}`);

      // A fresh document with the same localStorage: exactly what a tab switch does once
      // the webview is allowed to be destroyed while kept hidden. Wait for the rows too:
      // the pager text updates before the page's cells arrive, so asserting on the range
      // alone races the table (this started failing on antd 6, whose render order differs).
      await page.navigate(`${base}/harness-parquet?mixed=1`);
      // Restoring is row-based now, so the expected range is the page holding that row.
      const expected = rangeOf(size, 1, 300);
      const firstRowNumber = String(size + 1);
      const restored = await page.waitFor(
        `document.querySelector('.parquet-viewer__pager-info')?.innerText === ${JSON.stringify(expected)}` +
          ` && (${ROWS}[0])?.children[0]?.innerText === ${JSON.stringify(firstRowNumber)}`,
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
      const size = await pageSize(page);
      const state = await pagerState(page);
      expect(state.range === rangeOf(size, 0, 250000), `large range: ${state.range}`);

      // Leaving the field is not a decision, and it used to be: the jump fired on blur, so
      // looking at the table mid-edit navigated away. Only Enter and Go act now.
      await page.evaluate(`(() => {
                const input = document.querySelector('.parquet-viewer__row-jump input');
                const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                setter.call(input, '100');
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.focus();
                input.blur();
            })()`);
      await new Promise((resolve) => setTimeout(resolve, 400));
      const afterBlur = await page.evaluate(
        `document.querySelector('.parquet-viewer__pager-info')?.innerText ?? ''`,
      );
      expect(afterBlur === rangeOf(size, 0, 250000), `blur applied a row jump: ${afterBlur}`);
      // Enter is the contract.
      await page.evaluate(`(() => {
                const input = document.querySelector('.parquet-viewer__row-jump input');
                const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                setter.call(input, '100');
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.focus();
                input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
                input.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', bubbles: true }));
            })()`);
      const entered = await page.waitFor(
        `(document.querySelector('.parquet-viewer__pager-info')?.innerText ?? '') === ${JSON.stringify(rangeOf(size, Math.floor(99 / size), 250000))}`,
        8000,
      );
      expect(entered, "Enter did not apply the row jump");

      await page.evaluate(`(() => {
                const input = document.querySelector('.parquet-viewer__row-jump input');
                const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                setter.call(input, '240000');
                input.dispatchEvent(new Event('input', { bubbles: true }));
                [...document.querySelectorAll('.parquet-viewer__pager-btn')]
                    .find(b => b.textContent.trim() === 'Go')
                    ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            })()`);
      const expectedJump = rangeOf(size, Math.floor(239999 / size), 250000);
      const arrived = await page.waitFor(
        `(document.querySelector('.parquet-viewer__pager-info')?.innerText ?? '') === ${JSON.stringify(expectedJump)}`,
      );
      expect(arrived, `jump never reached row 240000 (expected ${expectedJump})`);
      const jumped = await pagerState(page);
      expect(jumped.range === expectedJump, `jump range: ${jumped.range}`);
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
      return "read-only + Enter and Go jumps";
    },
  },
  {
    name: "parquet-inline-buffer",
    async run({ page, base }) {
      // A virtual document arrives as base64 in the payload (GitHub Repos, `git:` history).
      // Rendering it at all proves the decode, and the range proves it is the same file.
      await openParquet(page, base, "?inline=1");
      const state = await pagerState(page);
      const size = await pageSize(page);
      expect(state.range === rangeOf(size, 0, 300), `inline range: ${state.range}`);
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
    name: "parquet-keyboard-paging",
    async run({ page, base }) {
      await openParquet(page, base, "?mixed=1");
      const size = await pageSize(page);
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

      // A page is one screenful now, so PageDown lands exactly on the next page — the step and
      // the page agree instead of skipping rows the reader never saw.
      await press("PageDown");
      const stepped = await page.waitFor(
        `(() => {
                const cell = document.activeElement?.getAttribute('data-cell') ?? '';
                const row = Number(cell.split(':')[0]);
                const range = document.querySelector('.parquet-viewer__pager-info')?.innerText ?? '';
                return row === 0 && range === ${JSON.stringify(rangeOf(size, 1, 300))};
            })()`,
        5000,
      );
      expect(stepped, `PageDown did not turn exactly one page (${await cursorAt()})`);

      // ArrowUp at the top of a page walks back to the previous page's last row.
      await press("ArrowUp");
      const back = await page.waitFor(
        `(document.querySelector('.parquet-viewer__pager-info')?.innerText ?? '') === ${JSON.stringify(rangeOf(size, 0, 300))}`,
        5000,
      );
      expect(back, "ArrowUp did not walk back a page");
      const onLast = await page.waitFor(
        `document.activeElement?.getAttribute('data-cell') === ${JSON.stringify(`${size - 1}:0`)}`,
        5000,
      );
      expect(
        onLast,
        `the cursor did not land on the previous page's last row (${await cursorAt()})`,
      );

      // Ctrl+End reaches the end of the file; Ctrl+Home comes back.
      await press("End", ", ctrlKey: true");
      const lastPage = Math.ceil(300 / size) - 1;
      const atEnd = await page.waitFor(
        `(document.querySelector('.parquet-viewer__pager-info')?.innerText ?? '') === ${JSON.stringify(rangeOf(size, lastPage, 300))}`,
        5000,
      );
      expect(atEnd, "Ctrl+End did not reach the last page");
      await press("Home", ", ctrlKey: true");
      const atStart = await page.waitFor(
        `(document.querySelector('.parquet-viewer__pager-info')?.innerText ?? '') === ${JSON.stringify(rangeOf(size, 0, 300))}`,
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

      // A copy has to answer: the button used to stay silent, which reads as "nothing happened".
      await page.evaluate(`document.querySelector('[aria-label="Copy value"]')
                .dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
      const receipt = await page.waitFor(`!!document.querySelector('[aria-label="Copied"]')`, 4000);
      expect(receipt, "copying gave no receipt");
      // The same path is reachable from the grid, where the value actually is.
      await page.evaluate(`(() => {
                const wrap = document.querySelector('.parquet-viewer__table-wrap');
                wrap.focus();
                wrap.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true }));
            })()`);
      const gridCopy = await page.waitFor(
        `!!document.querySelector('[aria-label="Copied"]')`,
        4000,
      );
      expect(gridCopy, "Ctrl+C on the grid did not copy the selected value");
      // Let the receipt expire: this scenario supplies the documentation screenshot, and a
      // permanent check mark would document a state that lasts 1.2 s.
      await page.waitFor(`!document.querySelector('[aria-label="Copied"]')`, 4000);

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
      const size = await pageSize(page);

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

      // Leaving the jump field is not a decision: typing a number and looking at the table used
      // to navigate away mid-edit. Only Enter (or Go) acts.
      const beforeBlur = await page.evaluate(
        `document.querySelector('.parquet-viewer__pager-info')?.innerText ?? ''`,
      );
      await page.evaluate(`(() => {
            const input = document.querySelector('.parquet-viewer__row-jump input');
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            setter.call(input, '250');
            input.dispatchEvent(new Event('input', { bubbles: true }));
            // blur() is a no-op on an element that is not focused, so focus first.
            input.focus();
            input.blur();
        })()`);
      await new Promise((resolve) => setTimeout(resolve, 400));
      const afterBlur = await page.evaluate(
        `document.querySelector('.parquet-viewer__pager-info')?.innerText ?? ''`,
      );
      expect(
        afterBlur === beforeBlur,
        `blurring the row field navigated: ${beforeBlur} -> ${afterBlur}`,
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
      const expectedJump = rangeOf(size, Math.floor(122 / size), 300);
      expect(range === expectedJump, `jump page range: ${range} (expected ${expectedJump})`);
      return "bool split + keyboard cursor + in-bar selection + target row";
    },
  },
  {
    name: "parquet-search",
    docs: "parquet-search.png",
    async run({ page, base }) {
      await openParquet(page, base, "?mixed=1");
      const size = await pageSize(page);
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
      expect(
        state.range === rangeOf(size, Math.floor(53 / size), 300),
        `did not jump to the match page: ${state.range}`,
      );
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
      // Setting the value and clicking in one go raced React: the button's handler closed over
      // the previous render's query. Commit the text first, then act on it.
      await page.evaluate(`(() => {
                const input = document.querySelector('.parquet-viewer__find-input');
                const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                setter.call(input, 'service-');
                input.dispatchEvent(new Event('input', { bubbles: true }));
            })()`);
      const typed = await page.waitFor(
        `(document.querySelector('.parquet-viewer__find-count')?.innerText ?? '').includes('Press Enter')`,
        4000,
      );
      expect(typed, "the new query never reached the field");
      await page.evaluate(`document.querySelector('.parquet-viewer__find-btn')
                .dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
      const many = await page.waitFor(
        `/^1 of 300$/.test((document.querySelector('.parquet-viewer__find-count')?.innerText ?? '').trim())`,
        15000,
      );
      expect(many, "a multi-hit scan did not report its position");
      const readPosition = () =>
        page.evaluate(
          `(document.querySelector('.parquet-viewer__find-count')?.innerText ?? '').trim()`,
        );
      const before = await readPosition();
      await page.evaluate(`(() => {
                const input = document.querySelector('.parquet-viewer__find-input');
                input.focus();
                input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
            })()`);
      // The step is the thing being tested, not which page it landed on: a hit on the next page
      // and a hit ten rows down are both "it moved".
      const stepped = await page.waitFor(
        `${JSON.stringify(before)} !== ${JSON.stringify("")} && (() => {
                const now = (document.querySelector('.parquet-viewer__find-count')?.innerText ?? '').trim();
                return now !== ${JSON.stringify(before)} && / of 300$/.test(now);
            })()`,
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
];
