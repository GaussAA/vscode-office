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
    name: "excel-large-file-guard",
    docs: "excel-too-large.png",
    async run({ page, base }) {
      // The stub claims 900 MB; the guard has to refuse before fetching anything, so the
      // grid must not be there and the panel must name the file and the limit.
      await page.navigate(`${base}/harness-route?route=excel&guard=1`);
      const panel = await page.waitFor(`!!document.querySelector('.excel-too-large')`, 15000);
      expect(panel, "the size guard did not render for an oversized file");
      await page.sleep(100);
      const state = json(
        await page.evaluate(`JSON.stringify({
                text: document.querySelector('.excel-too-large')?.innerText ?? '',
                grid: !!document.querySelector('#container .x-spreadsheet'),
                role: document.querySelector('.excel-too-large')?.getAttribute('role') ?? '',
                modal: document.querySelector('.excel-too-large')?.getAttribute('aria-modal') ?? '',
                active: document.activeElement?.textContent?.trim() ?? '',
                toggle: !!document.querySelector('.dark-mode-toggle'),
                buttons: [...document.querySelectorAll('.excel-too-large button')].map(b => b.textContent.trim()),
            })`),
      );
      expect(/huge\.csv/.test(state.text), `panel does not name the file: ${state.text}`);
      expect(/900\.0 MB/.test(state.text), `panel does not show the file size: ${state.text}`);
      expect(/200\.0 MB/.test(state.text), `panel does not show the limit: ${state.text}`);
      expect(state.role === "dialog", `guard is not a dialog: ${state.role}`);
      expect(state.modal === "true", "guard is not modal");
      expect(state.active === "Open in VS Code", `safe action does not own focus: ${state.active}`);
      expect(!state.toggle, "the floating theme toggle still overlaps the guard");
      expect(!state.grid, "the grid rendered anyway — the guard must not parse the file");
      expect(
        state.buttons.includes("Open anyway") && state.buttons.includes("Open in VS Code"),
        `guard actions: ${state.buttons.join(" / ")}`,
      );

      // Arming the retry must not leave Enter pointed at the memory bet.
      await page.evaluate(`[...document.querySelectorAll('.excel-too-large button')]
                .find(b => b.textContent.trim() === 'Open anyway')?.click()`);
      await page.sleep(120);
      const armed = json(
        await page.evaluate(`JSON.stringify({
                active: document.activeElement?.textContent?.trim() ?? '',
                confirm: document.querySelector('.excel-too-large-confirm')?.innerText ?? '',
            })`),
      );
      expect(armed.active === "Cancel", `arming the retry focused ${armed.active}`);
      expect(/9×/.test(armed.confirm), `confirmation does not name the cost: ${armed.confirm}`);
      await page.evaluate(`[...document.querySelectorAll('.excel-too-large button')]
                .find(b => b.textContent.trim() === 'Cancel')?.click()`);
      await page.sleep(120);
      expect(
        await page.evaluate(`document.activeElement?.textContent?.trim() === 'Open in VS Code'`),
        "cancelling the retry did not return focus to the safe action",
      );
      expect(
        await page.evaluate(`!document.querySelector('.excel-too-large-confirm')`),
        "the retry confirmation survived cancellation",
      );
      return "guard is a focused dialog with a safe primary and a second-step retry";
    },
  },
  {
    name: "excel-large-file-force",
    async run({ page, base }) {
      // The stub claims 900 MB; the guard has to refuse before fetching anything.
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
      expect(
        state.buttons.includes("Open in VS Code"),
        `missing the safe escape: ${state.buttons.join(" / ")}`,
      );

      // Answering "open anyway" arms a confirmation; only the second click may parse the file.
      await page.evaluate(`[...document.querySelectorAll('.excel-too-large button')]
                .find(b => b.textContent.trim() === 'Open anyway')?.click()`);
      const confirmed = await page.waitFor(
        `[...document.querySelectorAll('.excel-too-large button')]
                .some(b => b.textContent.trim() === 'Load full grid anyway')`,
        5000,
      );
      expect(confirmed, "the retry did not ask for a second confirmation");
      await page.evaluate(`[...document.querySelectorAll('.excel-too-large button')]
                .find(b => b.textContent.trim() === 'Load full grid anyway')?.click()`);
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
      const layout = json(
        await page.evaluate(`JSON.stringify({
                banner: document.querySelector('.excel-readonly-banner')?.getBoundingClientRect().toJSON() ?? null,
                toolbar: document.querySelector('.x-spreadsheet-toolbar')?.getBoundingClientRect().toJSON() ?? null,
            })`),
      );
      expect(
        !layout.banner || !layout.toolbar || layout.banner.bottom <= layout.toolbar.top + 1,
        "the read-only banner overlaps the spreadsheet toolbar",
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
                header: document.querySelector('.windowed-sheet__head-label')?.innerText ?? '',
                role: document.querySelector('.windowed-sheet__scroller')?.getAttribute('role') ?? '',
                rowcount: document.querySelector('.windowed-sheet__scroller')?.getAttribute('aria-rowcount') ?? '',
                toggle: !!document.querySelector('.dark-mode-toggle'),
            })`),
      );
      expect(!state.grid, "the editable grid mounted for a large file");
      // The served file is a header row plus 5000 data rows; row 1 is the frozen header, so
      // the body starts at row 2 while the total stays 5001.
      expect(state.total === 5001, `unexpected row count: ${state.total}`);
      expect(state.rows > 0 && state.rows < 80, `rendered ${state.rows} rows, expected a viewport`);
      expect(/Read-only/.test(state.banner), `missing the read-only banner: ${state.banner}`);
      expect(state.header === "id", `unexpected frozen header: ${state.header}`);
      expect(state.first === "r0", `unexpected first body cell: ${state.first}`);
      expect(state.role === "grid", `missing grid semantics: ${state.role}`);
      expect(state.rowcount === "5001", `unexpected aria-rowcount: ${state.rowcount}`);
      expect(!state.toggle, "the floating theme toggle still overlaps the windowed chrome");

      await page.evaluate(`(() => {
                const scroller = document.querySelector('.windowed-sheet__scroller');
                scroller.focus();
                scroller.dispatchEvent(new KeyboardEvent('keydown', {
                    key: 'ArrowDown', bubbles: true, cancelable: true,
                }));
            })()`);
      await page.sleep(120);
      const keyboard = json(
        await page.evaluate(`JSON.stringify({
                active: document.querySelector('.windowed-sheet__scroller')?.getAttribute('aria-activedescendant') ?? '',
                selected: document.querySelector('.windowed-sheet__cell--selected')?.innerText ?? '',
                value: document.querySelector('.windowed-sheet__selection')?.innerText ?? '',
            })`),
      );
      expect(keyboard.active === "windowed-sheet-cell-1-0", `active cell: ${keyboard.active}`);
      expect(keyboard.selected === "r1", `keyboard-selected cell: ${keyboard.selected}`);
      expect(/A3/.test(keyboard.value), `full-value channel: ${keyboard.value}`);

      const resizeBefore = json(
        await page.evaluate(`JSON.stringify({
                count: document.querySelectorAll('.windowed-sheet__resizer').length,
                width: document.querySelector('.windowed-sheet__resizer')?.parentElement
                    ?.getBoundingClientRect().width ?? 0,
            })`),
      );
      expect(resizeBefore.count === 8, `expected 8 column resizers, got ${resizeBefore.count}`);
      await page.evaluate(`(() => {
                const handle = document.querySelector('.windowed-sheet__resizer');
                handle?.focus();
                handle?.dispatchEvent(new KeyboardEvent('keydown', {
                    key: 'ArrowRight', bubbles: true, cancelable: true,
                }));
            })()`);
      await page.sleep(100);
      const resizeAfter = await page.evaluate(
        `document.querySelector('.windowed-sheet__resizer')?.parentElement
                ?.getBoundingClientRect().width ?? 0`,
      );
      expect(
        resizeAfter > resizeBefore.width + 4,
        `column resize did not widen the track: ${resizeBefore.width} -> ${resizeAfter}`,
      );
      await page.evaluate(`(() => {
                const handle = document.querySelector('.windowed-sheet__resizer');
                handle?.dispatchEvent(new KeyboardEvent('keydown', {
                    key: 'Home', bubbles: true, cancelable: true,
                }));
            })()`);
      await page.sleep(100);

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
    name: "excel-windowed-seek-limit",
    async run({ page, base }) {
      // 1.6M rows × 22px is 35.2M px, above Chromium's scroll-container limit. The view must
      // keep the DOM height capped and still make the final row reachable through the seek bar.
      await page.navigate(`${base}/harness-route?route=excel&window=1&windowRows=1600000`);
      const ready = await page.waitFor(`!!document.querySelector('.windowed-sheet__row')`, 20000);
      expect(ready, "the compressed windowed view did not render");
      const state = json(
        await page.evaluate(`JSON.stringify({
                total: Number(document.querySelector('.windowed-sheet')?.dataset.rows ?? 0),
                domRows: document.querySelectorAll('.windowed-sheet__row').length,
                scrollHeight: document.querySelector('.windowed-sheet__scroller')?.scrollHeight ?? 0,
                seek: !!document.querySelector('.windowed-sheet__seek'),
            })`),
      );
      expect(state.total === 1_600_001, `unexpected row count: ${state.total}`);
      expect(state.seek, "the compressed view did not switch to the seek window");
      expect(state.domRows > 0 && state.domRows < 80, `rendered ${state.domRows} rows`);
      expect(
        state.scrollHeight < 31_000_000,
        `scroll height is still above the browser cap: ${state.scrollHeight}`,
      );
      expect(state.scrollHeight > 29_000_000, `unexpected capped height: ${state.scrollHeight}`);

      await page.evaluate(`(() => {
                const scroller = document.querySelector('.windowed-sheet__scroller');
                scroller.scrollTop = scroller.scrollHeight;
                scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
            })()`);
      const reachedEnd = await page.waitFor(
        `[...document.querySelectorAll('.windowed-sheet__cell')].some(cell => cell.textContent === 'r1599999')`,
        15000,
      );
      expect(reachedEnd, "the last row is unreachable through the capped seek bar");
      return `1,600,001 records, height ${state.scrollHeight}px, last row reachable`;
    },
  },
  {
    name: "excel-save-direct",
    async run({ page, base }) {
      await page.navigate(`${base}/harness-route?route=excel&edit=direct`);
      const grid = await page.waitFor(
        `!!document.querySelector('#container .x-spreadsheet')`,
        15000,
      );
      expect(grid, "the editable grid did not render");

      await page.evaluate(
        `window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', code: 'KeyS', ctrlKey: true, bubbles: true, cancelable: true }))`,
      );
      const saved = await page.waitFor(
        `window.__excelMessages?.some(message => message.type === 'save')`,
        15000,
      );
      expect(saved, "Ctrl+S did not post a save");
      const done = await page.waitFor(`window.__saveDone === true`, 5000);
      expect(done, "saveDone did not arrive");

      const state = json(
        await page.evaluate(`JSON.stringify({
                messages: window.__excelMessages.filter(message => message.type === 'save'),
                modal: !!document.querySelector('.ant-modal'),
                saveDisabled: document.querySelector('.x-spreadsheet-toolbar-btn[data-tooltip*="Ctrl+S"]')
                    ?.classList.contains('disabled') ?? null,
            })`),
      );
      expect(state.messages.length === 1, `save messages: ${JSON.stringify(state.messages)}`);
      const message = state.messages[0];
      expect(
        message.base64Length > 0 || message.byteLength > 0,
        `save carried no bytes: ${JSON.stringify(message)}`,
      );
      expect(!state.modal, "the direct save opened a modal");
      expect(state.saveDisabled !== false, "saveDone did not disable the save button");
      return `direct save posted ${message.base64Length || message.byteLength} bytes, saveDone cleared dirty`;
    },
  },
  {
    name: "excel-save-format-confirm",
    async run({ page, base }) {
      await page.navigate(`${base}/harness-route?route=excel&edit=format`);
      const grid = await page.waitFor(
        `!!document.querySelector('#container .x-spreadsheet')`,
        15000,
      );
      expect(grid, "the editable legacy grid did not render");

      // Make the workbook formatted; a format that cannot keep it must ask before writing.
      await page.evaluate(`(() => {
                const bold = [...document.querySelectorAll('.x-spreadsheet-toolbar-btn')]
                    .find(button => (button.getAttribute('data-tooltip') || '').toLowerCase().includes('bold'));
                bold?.click();
            })()`);
      await page.sleep(120);
      await page.evaluate(
        `window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', code: 'KeyS', ctrlKey: true, bubbles: true, cancelable: true }))`,
      );
      const asked = await page.waitFor(
        `/Formatting cannot be preserved/i.test(document.querySelector('.ant-modal')?.innerText ?? '')`,
        10000,
      );
      expect(asked, "Ctrl+S did not ask before losing formatting");
      const beforeChoice = json(
        await page.evaluate(`JSON.stringify({
                saves: window.__excelMessages.filter(message => message.type === 'save').length,
                buttons: [...document.querySelectorAll('.ant-modal button')].map(button => button.textContent.trim()),
            })`),
      );
      expect(beforeChoice.saves === 0, "the format-loss branch wrote before the user chose");
      expect(
        beforeChoice.buttons.some((label) => /original/i.test(label)),
        `missing the original-format choice: ${beforeChoice.buttons.join(" / ")}`,
      );

      await page.evaluate(`[...document.querySelectorAll('.ant-modal button')]
                .find(button => /original/i.test(button.textContent))?.click()`);
      const saved = await page.waitFor(
        `window.__excelMessages?.some(message => message.type === 'save')`,
        15000,
      );
      expect(saved, "choosing the original format did not save");
      return `format-loss dialog blocked the write, then saved the original`;
    },
  },
  {
    name: "excel-save-format-original-success",
    async run({ page, base }) {
      await page.navigate(`${base}/harness-route?route=excel&edit=format`);
      const grid = await page.waitFor(
        `!!document.querySelector('#container .x-spreadsheet')`,
        15000,
      );
      expect(grid, "the editable grid did not render");

      // Make it formatted
      await page.evaluate(`(() => {
        const bold = [...document.querySelectorAll('.x-spreadsheet-toolbar-btn')]
          .find(button => (button.getAttribute('data-tooltip') || '').toLowerCase().includes('bold'));
        bold?.click();
      })()`);
      await page.sleep(120);

      // Ctrl+S opens the format-loss dialog
      await page.evaluate(
        `window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', code: 'KeyS', ctrlKey: true, bubbles: true, cancelable: true }))`,
      );
      const asked = await page.waitFor(
        `/Formatting cannot be preserved/i.test(document.querySelector('.ant-modal')?.innerText ?? '')`,
        10000,
      );
      expect(asked, "format-loss dialog did not open");

      const beforeClick = json(
        await page.evaluate(`JSON.stringify({
          saveEnabled: !document.querySelector('.x-spreadsheet-toolbar-btn[data-tooltip*="Ctrl+S"]')
            ?.classList.contains('disabled'),
        })`),
      );
      expect(beforeClick.saveEnabled, "save button was not enabled before clicking");

      // Click "Save as original format"
      await page.evaluate(`[...document.querySelectorAll('.ant-modal button')]
        .find(button => /original/i.test(button.textContent))?.click()`);
      const saved = await page.waitFor(
        `window.__excelMessages?.some(message => message.type === 'save')`,
        5000,
      );
      expect(saved, "clicking the original-format button did not post save");

      const done = await page.waitFor(`window.__saveDone === true`, 5000);
      expect(done, "saveDone did not arrive");

      await page.sleep(100);
      const afterSaveDone = json(
        await page.evaluate(`JSON.stringify({
          saveEnabled: !document.querySelector('.x-spreadsheet-toolbar-btn[data-tooltip*="Ctrl+S"]')
            ?.classList.contains('disabled'),
        })`),
      );
      expect(!afterSaveDone.saveEnabled, "save button did not disable after saveDone");

      return `original-format button called markSaveRequested, saveDone cleared dirty`;
    },
  },
  {
    name: "excel-save-format-original-failed",
    async run({ page, base }) {
      await page.navigate(`${base}/harness-route?route=excel&edit=format&failSave=1`);
      const grid = await page.waitFor(
        `!!document.querySelector('#container .x-spreadsheet')`,
        15000,
      );
      expect(grid, "the editable grid did not render");

      // Make it formatted
      await page.evaluate(`(() => {
        const bold = [...document.querySelectorAll('.x-spreadsheet-toolbar-btn')]
          .find(button => (button.getAttribute('data-tooltip') || '').toLowerCase().includes('bold'));
        bold?.click();
      })()`);
      await page.sleep(120);

      // Ctrl+S opens the format-loss dialog
      await page.evaluate(
        `window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', code: 'KeyS', ctrlKey: true, bubbles: true, cancelable: true }))`,
      );
      const asked = await page.waitFor(
        `/Formatting cannot be preserved/i.test(document.querySelector('.ant-modal')?.innerText ?? '')`,
        10000,
      );
      expect(asked, "format-loss dialog did not open");

      // Click "Save as original format"
      await page.evaluate(`[...document.querySelectorAll('.ant-modal button')]
        .find(button => /original/i.test(button.textContent))?.click()`);
      const saved = await page.waitFor(
        `window.__excelMessages?.some(message => message.type === 'save')`,
        5000,
      );
      expect(saved, "clicking the original-format button did not post save");

      const failed = await page.waitFor(`window.__saveFailed === true`, 5000);
      expect(failed, "saveFailed did not arrive");

      await page.sleep(100);
      const afterSaveFailed = json(
        await page.evaluate(`JSON.stringify({
          saveEnabled: !document.querySelector('.x-spreadsheet-toolbar-btn[data-tooltip*="Ctrl+S"]')
            ?.classList.contains('disabled'),
        })`),
      );
      expect(afterSaveFailed.saveEnabled, "save button did not re-enable after saveFailed");

      return `saveFailed transitioned back to dirty, save button re-enabled`;
    },
  },
  {
    name: "excel-save-readonly-saveas",
    async run({ page, base }) {
      await page.navigate(`${base}/harness-route?route=excel&edit=readonly`);
      const grid = await page.waitFor(
        `!!document.querySelector('#container .x-spreadsheet')`,
        15000,
      );
      expect(grid, "the read-only grid did not render");
      expect(
        await page.evaluate(`!!document.querySelector('.excel-readonly-banner')`),
        "the read-only banner is missing",
      );

      await page.evaluate(
        `window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', code: 'KeyS', ctrlKey: true, bubbles: true, cancelable: true }))`,
      );
      const dialog = await page.waitFor(
        `/Save As/i.test(document.querySelector('.ant-modal')?.innerText ?? '')`,
        5000,
      );
      expect(dialog, "Ctrl+S in a read-only document did not open Save As");
      const sends = await page.evaluate(
        `window.__excelMessages.filter(message => message.type === 'save' || message.type === 'saveAs').length`,
      );
      expect(sends === 0, `a read-only document wrote before choosing a target: ${sends}`);
      return "read-only Ctrl+S opened Save As without writing";
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

      // Ctrl+F must focus the inline Find, never mount the grid's dead FindReplacePanel.
      await page.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'f', code: 'KeyF', ctrlKey: true, bubbles: true, cancelable: true,
            }))`);
      const shortcut = await page.waitFor(
        `document.activeElement?.classList.contains('windowed-sheet__input')
                    && document.activeElement?.getAttribute('aria-label') === 'Find'`,
        5000,
      );
      expect(shortcut, "Ctrl+F did not focus the inline Find");
      expect(
        await page.evaluate(`!document.querySelector('.frp-panel')`),
        "Ctrl+F mounted the legacy FindReplacePanel in the windowed view",
      );

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

      // End the documented run on the match itself, not on the later jump.
      await page.evaluate(`[...document.querySelectorAll('.windowed-sheet__btn')]
                .find(b => b.textContent.trim() === 'Find')?.click()`);
      const returned = await page.waitFor(
        `[...document.querySelectorAll('.windowed-sheet__cell')].some(cell => cell.textContent === 'r4999')`,
        15000,
      );
      expect(returned, "find did not return to the match");
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
                header: document.querySelector('.windowed-sheet__head-label')?.innerText ?? '',
            })`),
      );
      expect(!state.grid, "the editable grid mounted for a workbook");
      expect(state.total === 201, `unexpected row count: ${state.total}`);
      expect(state.rows > 0 && state.rows < 80, `rendered ${state.rows} rows`);
      expect(state.header === "id", `unexpected frozen header: ${state.header}`);
      expect(state.first === "0", `unexpected first body cell: ${state.first}`);
      expect(state.sheets.join(",") === "Data,Extra", `sheet picker: ${state.sheets.join(",")}`);

      await page.evaluate(`(() => {
                const select = document.querySelector('.windowed-sheet__select');
                const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
                setter.call(select, '1');
                select.dispatchEvent(new Event('change', { bubbles: true }));
            })()`);
      const switched = await page.waitFor(
        `document.querySelector('.windowed-sheet__head-label')?.innerText === 'a'
                    && document.querySelector('.windowed-sheet__row .windowed-sheet__cell')?.innerText === 'b'`,
        15000,
      );
      expect(switched, "switching sheets did not show the second sheet");
      const total = await page.evaluate(
        `Number(document.querySelector('.windowed-sheet')?.dataset.rows ?? 0)`,
      );
      expect(total === 3, `second sheet has ${total} rows`);

      // Leave the documented screenshot on the real Data sheet, not the tiny Extra sheet.
      await page.evaluate(`(() => {
                const select = document.querySelector('.windowed-sheet__select');
                const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
                setter.call(select, '0');
                select.dispatchEvent(new Event('change', { bubbles: true }));
            })()`);
      const restored = await page.waitFor(
        `document.querySelector('.windowed-sheet__head-label')?.innerText === 'id'`,
        15000,
      );
      expect(restored, "the workbook did not return to the Data sheet");
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
                header: document.querySelector('.windowed-sheet__head-label')?.innerText ?? '',
                second: document.querySelectorAll('.windowed-sheet__row .windowed-sheet__cell')[1]?.innerText ?? '',
            })`),
      );
      expect(!state.grid, "the editable grid mounted for a legacy workbook");
      expect(state.total === 51, `unexpected row count: ${state.total}`);
      expect(state.rows > 0 && state.rows < 80, `rendered ${state.rows} rows`);
      expect(state.header === "id", `unexpected frozen header: ${state.header}`);
      expect(state.first === "0", `unexpected first body cell: ${state.first}`);
      expect(state.second === "legacy-0", `unexpected second body cell: ${state.second}`);
      return `51-row .xls windowed through SheetJS`;
    },
  },
  {
    name: "remaining-routes-smoke",
    async run({ page, base }) {
      // The routes without a behavioural scenario of their own: the spreadsheet viewer (the
      // Git History panel was removed in 6.8.0). Mount-only is enough — its real assertions
      // live in unit tests (excel_find) and in the smoke suite's routing checks.
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
  {
    name: "excel-save-as-keeps-dirty",
    async run({ page, base }) {
      await page.navigate(`${base}/harness-route?route=excel&edit=direct`);
      const grid = await page.waitFor(
        `!!document.querySelector('#container .x-spreadsheet')`,
        15000,
      );
      expect(grid, "the editable grid did not render");

      // Make an edit to get dirty state
      await page.evaluate(`(() => {
        const cell = document.querySelector('.x-spreadsheet-table .x-spreadsheet-cell');
        if (cell) cell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      })()`);
      await page.sleep(100);
      await page.evaluate(`(() => {
        const editor = document.querySelector('.x-spreadsheet-editor-area textarea');
        if (editor) {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
          setter.call(editor, 'modified');
          editor.dispatchEvent(new Event('input', { bubbles: true }));
          editor.blur();
        }
      })()`);
      await page.sleep(200);

      const beforeSaveAs = json(
        await page.evaluate(`JSON.stringify({
          saveEnabled: !document.querySelector('.x-spreadsheet-toolbar-btn[data-tooltip*="Ctrl+S"]')
            ?.classList.contains('disabled'),
          changeMessages: (window.__excelMessages || []).filter(m => m.type === 'change').length,
        })`),
      );
      expect(beforeSaveAs.saveEnabled, "save button did not enable after edit");
      expect(beforeSaveAs.changeMessages > 0, "no change message was sent after edit");

      // Click the Save As button in the toolbar
      await page.evaluate(`(() => {
        const saveAsBtn = [...document.querySelectorAll('.x-spreadsheet-toolbar-btn')]
          .find(btn => {
            const tooltip = btn.getAttribute('data-tooltip') || '';
            return tooltip.includes('Save As') || tooltip.includes('另存');
          });
        if (saveAsBtn) saveAsBtn.click();
      })()`);
      const modalOpen = await page.waitFor(
        `!!document.querySelector('.ant-modal') && /Save As/i.test(document.querySelector('.ant-modal')?.innerText ?? '')`,
        5000,
      );
      expect(modalOpen, "Save As dialog did not open");

      // Confirm Save As (this posts saveAs to the host)
      await page.evaluate(
        `[...document.querySelectorAll('.ant-modal button')].find(btn => btn.classList.contains('ant-btn-primary'))?.click()`,
      );
      await page.sleep(300);

      const afterSaveAs = json(
        await page.evaluate(`JSON.stringify({
          saveEnabled: !document.querySelector('.x-spreadsheet-toolbar-btn[data-tooltip*="Ctrl+S"]')
            ?.classList.contains('disabled'),
          saveDoneReceived: window.__saveDone === true,
          saveAsMessages: (window.__excelMessages || []).filter(m => m.type === 'saveAs').length,
        })`),
      );

      expect(afterSaveAs.saveAsMessages > 0, "saveAs message was not posted");
      expect(!afterSaveAs.saveDoneReceived, "saveDone arrived after Save As (should not)");
      expect(
        afterSaveAs.saveEnabled,
        "save button disabled after Save As (document should stay dirty)",
      );

      return `Save As posted, original document stays dirty, no saveDone`;
    },
  },
  {
    name: "excel-save-edit-during-pending",
    async run({ page, base }) {
      await page.navigate(`${base}/harness-route?route=excel&edit=direct&holdSave=1`);
      const grid = await page.waitFor(
        `!!document.querySelector('#container .x-spreadsheet')`,
        15000,
      );
      expect(grid, "the editable grid did not render");

      // Make an edit
      await page.evaluate(`(() => {
        const cell = document.querySelector('.x-spreadsheet-table .x-spreadsheet-cell');
        if (cell) cell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      })()`);
      await page.sleep(100);
      await page.evaluate(`(() => {
        const editor = document.querySelector('.x-spreadsheet-editor-area textarea');
        if (editor) {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
          setter.call(editor, 'first-edit');
          editor.dispatchEvent(new Event('input', { bubbles: true }));
          editor.blur();
        }
      })()`);
      await page.sleep(200);

      const afterFirstEdit = json(
        await page.evaluate(`JSON.stringify({
          changeCount: (window.__excelMessages || []).filter(m => m.type === 'change').length,
        })`),
      );
      expect(
        afterFirstEdit.changeCount === 1,
        `first edit should send 1 change, got ${afterFirstEdit.changeCount}`,
      );

      // Trigger save (goes to pending-save state, saveDone is held back)
      await page.evaluate(
        `window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', code: 'KeyS', ctrlKey: true, bubbles: true, cancelable: true }))`,
      );
      await page.waitFor(`window.__excelMessages?.some(message => message.type === 'save')`, 5000);

      const duringPending = json(
        await page.evaluate(`JSON.stringify({
          saveEnabled: !document.querySelector('.x-spreadsheet-toolbar-btn[data-tooltip*="Ctrl+S"]')
            ?.classList.contains('disabled'),
          releaseFnExists: typeof window.__releaseSaveDone === 'function',
        })`),
      );
      expect(!duringPending.saveEnabled, "save button still enabled during pending-save");
      expect(duringPending.releaseFnExists, "holdSave mode did not expose __releaseSaveDone");

      // Make another edit WHILE save is still pending
      await page.evaluate(`(() => {
        const cells = document.querySelectorAll('.x-spreadsheet-table .x-spreadsheet-cell');
        if (cells[1]) cells[1].dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      })()`);
      await page.sleep(100);
      await page.evaluate(`(() => {
        const editor = document.querySelector('.x-spreadsheet-editor-area textarea');
        if (editor) {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
          setter.call(editor, 'second-edit');
          editor.dispatchEvent(new Event('input', { bubbles: true }));
          editor.blur();
        }
      })()`);
      await page.sleep(200);

      const afterSecondEdit = json(
        await page.evaluate(`JSON.stringify({
          saveEnabled: !document.querySelector('.x-spreadsheet-toolbar-btn[data-tooltip*="Ctrl+S"]')
            ?.classList.contains('disabled'),
          changeCount: (window.__excelMessages || []).filter(m => m.type === 'change').length,
        })`),
      );
      expect(
        afterSecondEdit.saveEnabled,
        "save button did not re-enable after edit during pending",
      );
      expect(
        afterSecondEdit.changeCount === 2,
        `second edit should send another change, got ${afterSecondEdit.changeCount}`,
      );

      // Now release saveDone
      await page.evaluate(`window.__releaseSaveDone?.()`);
      const done = await page.waitFor(`window.__saveDone === true`, 5000);
      expect(done, "saveDone did not arrive after release");

      await page.sleep(100);
      const afterSaveDone = json(
        await page.evaluate(`JSON.stringify({
          saveEnabled: !document.querySelector('.x-spreadsheet-toolbar-btn[data-tooltip*="Ctrl+S"]')
            ?.classList.contains('disabled'),
        })`),
      );

      expect(
        afterSaveDone.saveEnabled,
        "save button disabled after saveDone (should stay enabled because of second edit)",
      );

      return `edit during pending-save keeps dirty after saveDone`;
    },
  },
  {
    name: "excel-replace-marks-dirty",
    async run({ page, base }) {
      await page.navigate(`${base}/harness-route?route=excel&edit=direct`);
      const grid = await page.waitFor(
        `!!document.querySelector('#container .x-spreadsheet')`,
        15000,
      );
      expect(grid, "the editable grid did not render");

      const beforeReplace = json(
        await page.evaluate(`JSON.stringify({
          saveEnabled: !document.querySelector('.x-spreadsheet-toolbar-btn[data-tooltip*="Ctrl+S"]')
            ?.classList.contains('disabled'),
          changeMessages: (window.__excelMessages || []).filter(m => m.type === 'change').length,
        })`),
      );
      expect(!beforeReplace.saveEnabled, "save button enabled before any edit");
      expect(beforeReplace.changeMessages === 0, "change message sent before any edit");

      // Open Find & Replace panel with Ctrl+H
      await page.evaluate(
        `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', code: 'KeyH', ctrlKey: true, bubbles: true, cancelable: true }))`,
      );
      const panelOpen = await page.waitFor(`!!document.querySelector('.frp-panel')`, 5000);
      expect(panelOpen, "Find & Replace panel did not open");

      // Enter find text
      await page.evaluate(`(() => {
        const input = document.querySelector('.frp-panel .frp-input');
        if (input) {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          setter.call(input, '1');
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
      })()`);
      await page.sleep(100);

      // Enter replace text
      await page.evaluate(`(() => {
        const inputs = document.querySelectorAll('.frp-panel .frp-input');
        if (inputs[1]) {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          setter.call(inputs[1], 'replaced');
          inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
        }
      })()`);
      await page.sleep(100);

      // Click Replace All (labeled as "All" in English)
      await page.evaluate(`(() => {
        const btns = [...document.querySelectorAll('.frp-action-btn')];
        const replaceAll = btns.find(btn => {
          const text = btn.textContent.trim();
          return text === 'All' || text.includes('全部') || text.includes('Replace All');
        });
        replaceAll?.click();
      })()`);
      await page.sleep(300);

      const afterReplace = json(
        await page.evaluate(`JSON.stringify({
          saveEnabled: !document.querySelector('.x-spreadsheet-toolbar-btn[data-tooltip*="Ctrl+S"]')
            ?.classList.contains('disabled'),
          changeMessages: (window.__excelMessages || []).filter(m => m.type === 'change').length,
          replaceStatus: document.querySelector('.frp-status')?.textContent ?? '',
        })`),
      );

      expect(afterReplace.saveEnabled, "save button did not enable after replace");
      expect(afterReplace.changeMessages > 0, "no change message sent to host after replace");
      expect(
        /\d+/.test(afterReplace.replaceStatus),
        `replace did not report count: ${afterReplace.replaceStatus}`,
      );

      return `Replace All marked dirty and sent change to host`;
    },
  },
];
