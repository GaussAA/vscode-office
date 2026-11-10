import {
  ROWS,
  clickNextPage,
  expect,
  firstRowCell,
  json,
  jumpJsonl,
  openEmptyJsonl,
  openJsonl,
  openParquet,
  pageSize,
  pagerState,
  rangeOf,
  unexpected,
} from "../helpers.mjs";

/** 8 scenario(s); the runner concatenates these lists. */
export default [
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
      // Said once, in the body. The footer used to repeat it, which made the bottom bar look
      // like a second error.
      expect(state.range === "", `empty pager says ${state.range}`);
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
      // The message is what a bug report needs; copying it used to be impossible.
      const copyError = await page.evaluate(`(() => {
                const button = document.querySelector('[aria-label="Copy error details"]');
                if (!button) return null;
                button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                return true;
            })()`);
      expect(copyError, "the error pane cannot copy its own message");
      const errorReceipt = await page.waitFor(
        `!!document.querySelector('[aria-label="Copied"]')`,
        4000,
      );
      expect(errorReceipt, "copying the error message gave no receipt");
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
      const size = await pageSize(page);
      const state = await pagerState(page);
      expect(state.range === rangeOf(size, 0, 300), `zstd range: ${state.range}`);
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
      const size = await pageSize(page);
      const first = await pagerState(page);
      expect(first.range === rangeOf(size, 0, 300), `page 1 range: ${first.range}`);
      expect(first.first === "1", `page 1 first row: ${first.first}`);
      await clickNextPage(page);
      const second = await pagerState(page);
      expect(second.range === rangeOf(size, 1, 300), `page 2 range: ${second.range}`);
      expect(second.first === String(size + 1), `page 2 first row: ${second.first}`);
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
      return `${rangeOf(size, 0, 300)} then ${rangeOf(size, 1, 300)}`;
    },
  },
  {
    name: "parquet-sidebar",
    async run({ page, base }) {
      await openParquet(page, base, "?mixed=1");
      const size = await pageSize(page);
      const state = json(
        await page.evaluate(`JSON.stringify({
                meta: [...document.querySelectorAll('.parquet-viewer__meta-item')].map((element) => element.innerText.trim()),
                siderBorder: getComputedStyle(document.querySelector('.parquet-viewer__sider')).borderRightWidth,
                topbarBorder: getComputedStyle(document.querySelector('.parquet-viewer__topbar')).borderBottomWidth,
                footerBorder: getComputedStyle(document.querySelector('.parquet-viewer__bottombar')).borderTopWidth,
            })`),
      );
      // Rows, columns, file size, codec, author. The size is one of the four questions
      // PRODUCT.md says the file is opened to answer, and it used to be the only one missing.
      expect(
        state.meta.length === 5 &&
          state.meta.some((item) => /CODEC/i.test(item)) &&
          state.meta.some((item) => /\d+\s?(B|KB|MB|GB)$/i.test(item.trim())),
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

      // The filter needs a way back that is not "select the text and delete it" — and clearing
      // it also restores the state this scenario documents.
      const cleared = await page.evaluate(`(() => {
                const clearBtn = document.querySelector('.parquet-viewer__field-filter-clear');
                if (!clearBtn) return null;
                clearBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                return true;
            })()`);
      expect(cleared, "the field filter has no clear button");
      const unfiltered = await page.waitFor(
        `document.querySelectorAll('.parquet-viewer__list-item').length === 4`,
        4000,
      );
      expect(unfiltered, "clearing the filter did not restore the fields");

      // Where you are in the file, not only how many rows that is.
      const pageLabel = await page.evaluate(
        `(document.querySelector('.parquet-viewer__pager-page')?.innerText ?? '').trim()`,
      );
      const totalPages = Math.ceil(300 / size);
      expect(
        pageLabel === `Page 1 of ${totalPages}`,
        `pager page position: "${pageLabel}" (expected Page 1 of ${totalPages})`,
      );

      // Density: spare viewport width grows the columns, but only up to a cap. Stretching a
      // four-column file to fill 1239px turned `id` into a 273px panel.
      const layout = json(
        await page.evaluate(`JSON.stringify((() => {
                const wrap = document.querySelector('.parquet-viewer__table-wrap');
                const heads = [...document.querySelectorAll('.parquet-table thead th')];
                const body = [...document.querySelectorAll('.ant-table-tbody-virtual-holder-inner > *')][0];
                const cells = [...(body?.querySelectorAll('.ant-table-cell') ?? [])];
                return {
                    wrap: Math.round(wrap?.getBoundingClientRect().width ?? 0),
                    headWidths: heads.map(th => Math.round(th.getBoundingClientRect().width)),
                    cellWidths: cells.map(cell => Math.round(cell.getBoundingClientRect().width)),
                };
            })())`),
      );
      const dataHeads = layout.headWidths.slice(1);
      const widest = Math.max(...dataHeads);
      expect(
        widest <= 240,
        `a column grew to ${widest}px (cap is 240): ${JSON.stringify(layout.headWidths)}`,
      );
      expect(
        widest > 120,
        `columns did not use the spare width at all: ${JSON.stringify(layout.headWidths)}`,
      );
      // The body has to lay out at the same widths, or the header lies about its own columns.
      expect(
        layout.cellWidths.join(",") === layout.headWidths.join(","),
        `body ${JSON.stringify(layout.cellWidths)} vs header ${JSON.stringify(layout.headWidths)}`,
      );

      return `${state.meta.length} inline meta items, filterable schema, one tab stop`;
    },
  },
  {
    name: "parquet-column-resize",
    async run({ page, base }) {
      // Twelve columns: the table overflows, so the widths this scenario sets are the widths
      // that render. On a four-column file antd stretches the columns to fill the viewport and
      // a 80px drag lands as a much larger step.
      await openParquet(page, base, "?preview=1");
      const measure = `(() => {
                const heads = [...document.querySelectorAll('.parquet-table thead th')];
                const nameHead = heads[2];
                const colIndex = nameHead?.getAttribute('aria-colindex');
                const cell = document.querySelector(
                    '.ant-table-tbody-virtual .ant-table-cell[aria-colindex="' + colIndex + '"]',
                );
                return {
                    heads: heads.length,
                    resizers: document.querySelectorAll('.parquet-viewer__column-resizer').length,
                    nameWidth: nameHead ? Math.round(nameHead.getBoundingClientRect().width) : null,
                    cellWidth: cell ? Math.round(cell.getBoundingClientRect().width) : null,
                    separatorRole: document.querySelector('.parquet-viewer__column-resizer')?.getAttribute('role'),
                };
            })()`;
      const before = json(await page.evaluate(`JSON.stringify(${measure})`));
      // The index column keeps its width: only data columns own a handle.
      expect(
        before.resizers === before.heads - 1,
        `${before.resizers} handles for ${before.heads} columns`,
      );
      expect(before.separatorRole === "separator", `resizer role: ${before.separatorRole}`);

      // Drag the NAME column 80px wider. The handle sits on the header's right edge; the width
      // the virtual scroller uses has to follow, not just the header's.
      const dragged = await page.evaluate(`(() => {
                const heads = [...document.querySelectorAll('.parquet-table thead th')];
                const head = heads[2];
                const handle = head?.querySelector('.parquet-viewer__column-resizer');
                if (!handle) return null;
                const box = handle.getBoundingClientRect();
                const x = box.left + box.width / 2;
                const y = box.top + box.height / 2;
                const at = (px) => ({ clientX: px, clientY: y, bubbles: true, pointerId: 1, button: 0, buttons: 1 });
                handle.dispatchEvent(new PointerEvent('pointerdown', at(x)));
                handle.dispatchEvent(new PointerEvent('pointermove', at(x + 80)));
                handle.dispatchEvent(new PointerEvent('pointerup', at(x + 80)));
                return true;
            })()`);
      expect(dragged, "the NAME column has no resize handle");
      await new Promise((resolve) => setTimeout(resolve, 200));
      const after = json(await page.evaluate(`JSON.stringify(${measure})`));
      expect(
        after.nameWidth === before.nameWidth + 80,
        `header width ${before.nameWidth} -> ${after.nameWidth}`,
      );
      expect(
        after.cellWidth >= after.nameWidth - 1,
        `body cell width ${after.cellWidth} did not follow the header (${after.nameWidth})`,
      );

      // It survives a reload: a column width is a reading decision, not a per-visit one.
      await openParquet(page, base, "?preview=1");
      const reloaded = json(await page.evaluate(`JSON.stringify(${measure})`));
      expect(
        reloaded.nameWidth === after.nameWidth,
        `width did not persist: ${reloaded.nameWidth} after reload, ${after.nameWidth} before`,
      );

      // Double-click resets it.
      await page.evaluate(`(() => {
                const heads = [...document.querySelectorAll('.parquet-table thead th')];
                const head = heads[2];
                head?.querySelector('.parquet-viewer__column-resizer')
                    ?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
            })()`);
      await new Promise((resolve) => setTimeout(resolve, 200));
      const reset = json(await page.evaluate(`JSON.stringify(${measure})`));
      expect(
        reset.nameWidth === before.nameWidth,
        `double-click did not reset the width: ${reset.nameWidth} vs ${before.nameWidth}`,
      );

      // Keyboard parity: the handle is a separator, so arrows resize it.
      await page.evaluate(`(() => {
                const heads = [...document.querySelectorAll('.parquet-table thead th')];
                const head = heads[2];
                const handle = head?.querySelector('.parquet-viewer__column-resizer');
                handle?.focus();
                handle?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
            })()`);
      await new Promise((resolve) => setTimeout(resolve, 200));
      const keyed = json(await page.evaluate(`JSON.stringify(${measure})`));
      expect(
        keyed.nameWidth === before.nameWidth + 8,
        `arrow key resize: ${before.nameWidth} -> ${keyed.nameWidth}`,
      );
      return "column widths: drag, persist, reset, keyboard";
    },
  },
  {
    name: "parquet-tokens",
    async run({ page, base }) {
      await openParquet(page, base, "?mixed=1");
      // Ten icon tokens used to repeat four `var(--vscode-charts-*)` reads. They are aliases of
      // six base tokens now; a design token is only a source of truth if the aliases really
      // resolve to it, so assert the graph instead of trusting the stylesheet.
      const tokens = json(
        await page.evaluate(`JSON.stringify((() => {
                const root = document.querySelector('.parquet-viewer');
                const style = getComputedStyle(root);
                const value = (name) => style.getPropertyValue(name).trim();
                return {
                    blue: value('--pv-chart-blue'),
                    rows: value('--pv-icon-rows'),
                    numeric: value('--pv-icon-numeric'),
                    purple: value('--pv-chart-purple'),
                    author: value('--pv-icon-author'),
                    datetime: value('--pv-icon-datetime'),
                    teal: value('--pv-chart-teal'),
                    schema: value('--pv-icon-schema'),
                    structure: value('--pv-icon-structure'),
                };
            })())`),
      );
      expect(tokens.blue === "#3794ff", `chart blue resolved to "${tokens.blue}"`);
      expect(
        tokens.rows === tokens.blue && tokens.numeric === tokens.blue,
        `the blue icons do not share one token: ${JSON.stringify(tokens)}`,
      );
      expect(
        tokens.author === tokens.purple && tokens.datetime === tokens.purple,
        `the purple icons do not share one token: ${JSON.stringify(tokens)}`,
      );
      expect(
        tokens.schema === tokens.teal && tokens.structure === tokens.teal,
        `the teal icons do not share one token: ${JSON.stringify(tokens)}`,
      );
      return `icon tokens alias 6 chart colours (blue ${tokens.blue})`;
    },
  },
];
