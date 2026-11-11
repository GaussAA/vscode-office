import { expect, json, jumpJsonl, openEmptyJsonl, openJsonl, unexpected } from "../helpers.mjs";

/** 15 scenario(s); the runner concatenates these lists. */
export default [
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
      expect(state.raw === 1_000_000, `too-large raw text is ${state.raw} chars`);
      return "too-large line: warn chip, truncated raw text";
    },
  },
  {
    name: "jsonl-long-value-panel",
    docs: "jsonl-value-panel.png",
    async run({ page, base }) {
      await openJsonl(page, base);
      await jumpJsonl(page, 14);
      await page.evaluate(`(() => {
                const row = [...document.querySelectorAll('.jsonl-detail__tree .ant-tree-treenode')]
                    .find(node => node.innerText.startsWith('longValue'));
                row?.querySelector('.ant-tree-node-content-wrapper')
                    ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            })()`);
      const opened = await page.waitFor(`!!document.querySelector('.jsonl-valuebar')`);
      expect(opened, "selecting a string row did not open the value bar");
      const collapsed = json(
        await page.evaluate(`JSON.stringify({
                path: document.querySelector('.jsonl-valuebar__path')?.innerText ?? null,
                expanded: document.querySelector('.jsonl-valuebar__toggle')?.getAttribute('aria-expanded'),
                body: !!document.querySelector('.jsonl-valuebar__text'),
                preview: document.querySelector('.jsonl-valuebar__preview')?.innerText.length ?? 0,
                treePreview: [...document.querySelectorAll('.jsonl-val')]
                    .map(node => node.textContent.length)
                    .sort((a, b) => b - a)[0] ?? 0,
            })`),
      );
      expect(collapsed.path === "longValue", `value bar path is ${collapsed.path}`);
      expect(collapsed.expanded === "false", "the value panel opened on selection");
      expect(!collapsed.body, "the value panel rendered its body while collapsed");
      expect(collapsed.treePreview <= 130, `tree preview is ${collapsed.treePreview} chars`);

      // The keyboard path: Enter on the focused tree/pane toggles the panel.
      await page.evaluate(`(() => {
                const detail = document.querySelector('.jsonl-detail');
                detail.focus();
                detail.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
            })()`);
      const expanded = await page.waitFor(`!!document.querySelector('.jsonl-valuebar__text')`);
      expect(expanded, "Enter did not expand the value panel");
      const state = json(
        await page.evaluate(`JSON.stringify({
                chars: document.querySelector('.jsonl-valuebar__text')?.textContent.length ?? 0,
                tail: document.querySelector('.jsonl-valuebar__text')?.textContent.slice(-4) ?? null,
                count: document.querySelector('.jsonl-valuebar__count')?.innerText ?? null,
                toggleLabel: document.querySelector('.jsonl-valuebar__toggle')?.getAttribute('aria-label'),
            })`),
      );
      expect(state.chars === 5000, `value panel shows ${state.chars} characters`);
      expect(state.tail === "oong", `value panel tail is ${state.tail}`);
      expect(/5,000 characters/.test(state.count ?? ""), `value count is ${state.count}`);
      // The button's accessible name is its action, not "path preview type count ...".
      expect(state.toggleLabel === "Collapse value", `value toggle label is ${state.toggleLabel}`);
      // Ctrl+C on the toggle (not only on the tree) copies the whole value.
      await page.evaluate(`(() => {
                window.__copied = [];
                Object.defineProperty(navigator, 'clipboard', {
                    configurable: true,
                    value: { writeText: async (text) => { window.__copied.push(text); } },
                });
                const toggle = document.querySelector('.jsonl-valuebar__toggle');
                toggle.focus();
                toggle.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true }));
            })()`);
      await new Promise((resolve) => setTimeout(resolve, 80));
      const copied = await page.evaluate(`window.__copied?.[0]?.length ?? 0`);
      expect(copied === 5000, `Ctrl+C copied ${copied} characters, not 5,000`);
      // Escape closes the panel from inside its scroll area and must not strand focus on body.
      await page.evaluate(`(() => {
                const text = document.querySelector('.jsonl-valuebar__text');
                text.focus();
                text.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            })()`);
      const restored = await page.waitFor(
        `document.activeElement?.classList.contains('jsonl-valuebar__toggle') && !document.querySelector('.jsonl-valuebar__text')`,
      );
      expect(restored, "Escape did not close the panel and restore focus to its toggle");
      return `tree ${collapsed.treePreview} chars, panel 5,000 chars, Enter/Ctrl+C/Escape work`;
    },
  },
  {
    name: "jsonl-long-tree-reaches-its-last-row",
    async run({ page, base }) {
      await openJsonl(page, base);
      await jumpJsonl(page, 14);
      const reached = await page.evaluate(`(async () => {
                const holder = document.querySelector('.jsonl-detail__tree .ant-tree-list-holder');
                if (!holder) return JSON.stringify({ missing: true });
                holder.scrollTop = holder.scrollHeight;
                await new Promise(resolve => setTimeout(resolve, 250));
                holder.scrollTop = holder.scrollHeight;
                await new Promise(resolve => setTimeout(resolve, 250));
                const more = document.querySelector('.jsonl-detail__tree .jsonl-more');
                const holderRect = holder.getBoundingClientRect();
                const rect = more?.getBoundingClientRect();
                return JSON.stringify({
                    scrollTop: Math.round(holder.scrollTop),
                    max: holder.scrollHeight - holder.clientHeight,
                    text: more?.innerText ?? null,
                    visible: !!rect && rect.top >= holderRect.top - 1 && rect.bottom <= holderRect.bottom + 1,
                });
            })()`);
      const state = json(reached);
      expect(!state.missing, "the virtual tree has no scroll holder");
      expect(/2301 more keys/.test(state.text ?? ""), `overflow row is ${state.text}`);
      expect(
        state.visible,
        `overflow row is outside the viewport (${state.scrollTop}/${state.max})`,
      );
      return `2,500-key entry: last row "${state.text}" reached at ${state.scrollTop}/${state.max}px`;
    },
  },
  {
    name: "jsonl-heavy-entry-wraps",
    async run({ page, base }) {
      await openJsonl(page, base);
      await jumpJsonl(page, 16);
      const ready = await page.waitFor(
        `document.querySelector('.jsonl-detail__index')?.innerText === 'L16' && !!document.querySelector('.jsonl-detail__tree')`,
      );
      expect(ready, "the heavy entry never rendered");
      const state = json(
        await page.evaluate(`JSON.stringify((() => {
                const values = [...document.querySelectorAll('.jsonl-detail__tree .jsonl-val')]
                    .map(node => node.textContent ?? "");
                const description = values.find(text => text.includes("tail-marker-heavy")) ?? "";
                return {
                    scroll: !!document.querySelector('.jsonl-detail__scroll'),
                    wraps: document.querySelectorAll('.jsonl-detail__tree .jsonl-val--wrap').length,
                    description,
                };
            })())`),
      );
      expect(state.scroll, "the heavy entry stayed in the single-line virtual list");
      expect(state.wraps > 0, "no wrapped values in the heavy entry");
      expect(
        state.description.length > 400,
        `description is only ${state.description.length} chars`,
      );
      expect(
        state.description.endsWith("tail-marker-heavy"),
        `description tail is ${state.description.slice(-40)}`,
      );
      return `${state.wraps} wrapped values; heavy-entry description ${state.description.length} chars`;
    },
  },
  {
    name: "jsonl-many-rows-reach-the-last-entry",
    async run({ page, base }) {
      await openJsonl(page, base, "dark", "&many=300");
      const reached = await page.evaluate(`(async () => {
                const holder = document.querySelector('.jsonl-index__tree .ant-tree-list-holder');
                if (!holder) return JSON.stringify({ missing: true });
                holder.scrollTop = holder.scrollHeight;
                await new Promise(resolve => setTimeout(resolve, 250));
                holder.scrollTop = holder.scrollHeight;
                await new Promise(resolve => setTimeout(resolve, 250));
                const rows = [...document.querySelectorAll('.jsonl-index__tree .ant-tree-treenode')];
                const holderRect = holder.getBoundingClientRect();
                const last = rows[rows.length - 1];
                const rect = last?.getBoundingClientRect();
                return JSON.stringify({
                    scrollTop: Math.round(holder.scrollTop),
                    max: holder.scrollHeight - holder.clientHeight,
                    lastLine: last?.querySelector('.jsonl-lineno')?.innerText ?? null,
                    visible: !!rect && rect.top >= holderRect.top - 1 && rect.bottom <= holderRect.bottom + 1,
                });
            })()`);
      const state = json(reached);
      expect(!state.missing, "the directory has no scroll holder");
      expect(state.lastLine === "300", `last rendered entry is ${state.lastLine}`);
      expect(state.visible, `entry 300 is outside the viewport (${state.scrollTop}/${state.max})`);
      return `entry 300 reached at ${state.scrollTop}/${state.max}px`;
    },
  },
  {
    name: "jsonl-search-then-jump-recenters",
    async run({ page, base }) {
      // The old fixture (14 rows) could not expose the bug: its initial window already held
      // the target. With 1000 rows the initial window is [1, 500), so row 900 only appears if
      // clearing search actually recentred the directory.
      await openJsonl(page, base, "dark", "&many=1000");
      await page.evaluate(`(() => {
                const input = document.querySelector('.jsonl-search input');
                const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                input.focus();
                setter.call(input, 'id');
                input.dispatchEvent(new Event('input', { bubbles: true }));
            })()`);
      const matched = await page.waitFor(`(() => {
                const text = document.querySelector('.jsonl-search-status')?.innerText ?? '';
                return /\\d+ match/.test(text) && !text.includes('Searching');
            })()`);
      expect(matched, "search did not settle before the jump");
      await jumpJsonl(page, 900);
      const recentred = await page.waitFor(
        `document.querySelector('.jsonl-index__tree .ant-tree-treenode-selected .jsonl-lineno')?.innerText === '900'`,
      );
      expect(recentred, "the directory did not recentre on the jumped-to entry");
      const state = json(
        await page.evaluate(`JSON.stringify({
                status: document.querySelector('.jsonl-search-status')?.innerText ?? null,
                selected: document.querySelector('.jsonl-index__tree .ant-tree-treenode-selected .jsonl-lineno')?.innerText ?? null,
                query: document.querySelector('.jsonl-search input')?.value ?? null,
            })`),
      );
      expect(state.status === null, `search status survived the jump: ${state.status}`);
      expect(state.query === "", `search field still holds ${state.query}`);
      expect(state.selected === "900", `directory recentred on ${state.selected}, not 900`);
      return "search cleared, directory recentred on L900";
    },
  },
  {
    name: "jsonl-truncation-is-visible",
    async run({ page, base }) {
      await openJsonl(page, base);
      await jumpJsonl(page, 11);
      const tree = json(
        await page.evaluate(`JSON.stringify({
                warning: document.querySelector('.jsonl-detail__error .jsonl-chip--warn')?.innerText ?? null,
                hint: [...document.querySelectorAll('.jsonl-detail__error .jsonl-detail__notice')].map(n => n.innerText).join(' '),
            })`),
      );
      expect(/too large/i.test(tree.warning ?? ""), `too-large chip is ${tree.warning}`);
      expect(/8\.0 MB/.test(tree.hint), `missing parse limit: ${tree.hint}`);
      expect(
        /Showing the first 1,000,000 of 9,437,184 characters/.test(tree.hint),
        `missing truncation notice: ${tree.hint}`,
      );
      // The raw view carries the same notice; a silent 200k cut was the bug.
      await page.evaluate(`[...document.querySelectorAll('.ant-segmented-item')]
                .find(node => node.innerText.trim() === 'Raw')
                ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
      const notice = await page.waitFor(
        `!!document.querySelector('.jsonl-detail__rawpane .jsonl-detail__notice')`,
      );
      expect(notice, "raw view hid the fact that its text is truncated");
      return "8 MB hint + character-counted truncation notice in tree and raw";
    },
  },
  {
    name: "jsonl-short-window-load-more",
    async run({ page, base }) {
      // A byte-budgeted host can return one row per request. If that window never overflows
      // the pane there is no scrollbar and no scroll event, so the directory must fill itself
      // and leave a row that can request the next chunk.
      await openJsonl(page, base, "dark", "&many=300&limit=1");
      const loaded = await page.waitFor(
        `Number(document.querySelector('.jsonl-index')?.dataset.loaded ?? 0) >= 4`,
      );
      expect(loaded, "a short window never auto-filled");
      const button = await page.waitFor(`!!document.querySelector('.jsonl-load-more')`);
      expect(button, "a short window has no load-more row");
      const before = Number(
        await page.evaluate(`document.querySelector('.jsonl-index')?.dataset.loaded ?? 0`),
      );
      const visible = await page.evaluate(`(() => {
                const holder = document.querySelector('.jsonl-index__tree .ant-tree-list-holder');
                const more = document.querySelector('.jsonl-load-more');
                if (!holder || !more) return false;
                const h = holder.getBoundingClientRect();
                const r = more.getBoundingClientRect();
                return r.top >= h.top - 1 && r.bottom <= h.bottom + 1;
            })()`);
      expect(visible, "the load-more row is outside the pane");
      await page.evaluate(`document.querySelector('.jsonl-load-more')?.click()`);
      const grew = await page.waitFor(
        `Number(document.querySelector('.jsonl-index')?.dataset.loaded ?? 0) > ${before}`,
      );
      expect(grew, "the load-more row did not append another chunk");
      return `${before} rows auto-filled from 1-row chunks; load-more appends`;
    },
  },
  {
    name: "jsonl-scalar-root-panel",
    async run({ page, base }) {
      // A line whose value is one long string has no tree row to select; the panel is still
      // the only way to read it past the 120-character preview.
      await openJsonl(page, base);
      await jumpJsonl(page, 15);
      const bar = await page.waitFor(`!!document.querySelector('.jsonl-valuebar__toggle')`);
      expect(bar, "a scalar root got no value panel");
      const state = json(
        await page.evaluate(`JSON.stringify({
                treeRows: document.querySelectorAll('.jsonl-detail__tree .ant-tree-treenode').length,
                path: document.querySelector('.jsonl-valuebar__path')?.innerText ?? null,
                expanded: document.querySelector('.jsonl-valuebar__toggle')?.getAttribute('aria-expanded'),
            })`),
      );
      expect(state.treeRows === 0, `scalar root rendered ${state.treeRows} tree rows`);
      expect(state.path === "L15", `scalar root path is ${state.path}`);
      expect(state.expanded === "false", "the scalar panel opened on selection");
      await page.evaluate(`(() => {
                const detail = document.querySelector('.jsonl-detail');
                detail.focus();
                detail.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
            })()`);
      const opened = await page.waitFor(`!!document.querySelector('.jsonl-valuebar__text')`);
      expect(opened, "Enter did not expand the scalar value");
      const chars = await page.evaluate(
        `document.querySelector('.jsonl-valuebar__text')?.textContent.length ?? 0`,
      );
      expect(chars === 312, `scalar panel shows ${chars} characters`);
      return "scalar root: panel opens without a tree row, 312 chars";
    },
  },
];
