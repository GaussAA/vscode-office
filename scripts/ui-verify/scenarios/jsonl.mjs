import {
  expect,
  json,
  jumpJsonl,
  openEmptyJsonl,
  openJsonl,
  setInput,
  unexpected,
} from "../helpers.mjs";
import { describeFrames, framesOf, summarizeFrames } from "../frames.mjs";

/** 19 scenario(s); the runner concatenates these lists. */
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
    name: "jsonl-hit-centred-summary",
    async run({ page, base }) {
      await openJsonl(page, base);
      await page.evaluate(`(() => {
                const input = document.querySelector('.jsonl-search input');
                const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                input.focus();
                setter.call(input, 'tail-marker');
                input.dispatchEvent(new Event('input', { bubbles: true }));
            })()`);
      await page.waitFor(`!!document.querySelector('.jsonl-index .jsonl-hit')`);
      await page.evaluate(`(() => {
                const row = [...document.querySelectorAll('.jsonl-index__tree .ant-tree-treenode')]
                    .find(node => /tail-marker/.test(node.innerText));
                row?.querySelector('.ant-tree-node-content-wrapper')
                    ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            })()`);
      const centred = await page.waitFor(
        `[...document.querySelectorAll('.jsonl-detail__tree .jsonl-val')].some(node => (node.textContent ?? '').includes('tail-marker'))`,
      );
      expect(centred, "the selected entry's tree never showed a summary containing the hit");
      const state = json(
        await page.evaluate(`JSON.stringify((() => {
                const leaves = [...document.querySelectorAll('.jsonl-detail__tree .jsonl-val')]
                    .map(node => node.textContent ?? "");
                const hit = leaves.find(text => text.includes('tail-marker')) ?? "";
                return {
                    hit,
                    lead: hit.startsWith('"…'),
                    marks: document.querySelectorAll('.jsonl-detail__tree mark.jsonl-hit').length,
                };
            })())`),
      );
      expect(state.hit.length > 0, "no value summary contains the search hit");
      expect(state.lead, `summary does not start at the hit window: ${state.hit.slice(0, 40)}`);
      expect(state.marks > 0, "the tree row does not mark the hit");
      return `hit-centred summary (${state.hit.length} chars), ${state.marks} mark(s)`;
    },
  },
  {
    name: "jsonl-big-entry-stays-single-line",
    async run({ page, base }) {
      await openJsonl(page, base);
      await jumpJsonl(page, 14);
      const state = json(
        await page.evaluate(`JSON.stringify({
                tree: !!document.querySelector('.jsonl-detail__tree'),
                wrapClass: document.querySelectorAll('.jsonl-val--wrap').length,
                rows: document.querySelectorAll('.jsonl-detail__tree .ant-tree-treenode').length,
            })`),
      );
      expect(state.tree, "big entry rendered no tree");
      expect(state.wrapClass === 0, `wrap mode still rendered ${state.wrapClass} values`);
      expect(state.rows > 0, "the virtual tree rendered no rows");
      return `${state.rows} fixed-height rows, no wrap mode`;
    },
  },
  {
    name: "jsonl-search",
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
    name: "jsonl-search-hit-kind",
    async run({ page, base }) {
      // Issue #3, the "distinguish a key hit from a value hit" half. The substring scan cannot
      // say which; the matched line is parsed anyway to derive its label, so the badge costs
      // nothing extra. `key` and `value` are structure, not prose — untranslated, like LIST.
      const search = async (needle, kind) => {
        await page.evaluate(`(() => {
                    const input = document.querySelector('.jsonl-search input');
                    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                    input.focus();
                    setter.call(input, ${JSON.stringify(needle)});
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                })()`);
        await page.waitFor(
          `(() => {
                    const text = document.querySelector('.jsonl-search-status')?.innerText ?? '';
                    return /\\d+ match/.test(text) && !text.includes('Searching');
                })()`,
          8000,
        );
        // The status settles a tick before the rows do; wait for the badge this query must produce.
        const shown = await page.waitFor(
          `document.querySelectorAll('.jsonl-chip--hit-${kind}').length > 0`,
          8000,
        );
        expect(shown, `no .jsonl-chip--hit-${kind} rendered for "${needle}"`);
        return json(
          await page.evaluate(`JSON.stringify({
                        badges: [...document.querySelectorAll('.jsonl-chip--hit')].map((chip) => chip.innerText.trim()),
                    })`),
        );
      };

      await openJsonl(page, base);
      // `id`/`name`/`tags` are keys in every fixture line; `processed` appears only inside values.
      const keyHits = await search("id", "key");
      expect(
        keyHits.badges.every((badge) => !badge.includes("value")),
        `a key-only query was labelled as a value hit: ${JSON.stringify(keyHits.badges)}`,
      );
      const valueHits = await search("processed", "value");
      expect(
        valueHits.badges.every((badge) => badge.includes("value")),
        `a value-only query was not labelled as a value hit: ${JSON.stringify(valueHits.badges)}`,
      );

      return `key query → ${keyHits.badges.length} key chips, value query → ${valueHits.badges.length} value chips`;
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
      // ADR-0030: the body is a 120-character summary; the raw text lives in the value panel.
      expect(state.raw === 120, `too-large body is ${state.raw} chars, not the 120 summary`);
      await page.evaluate(`(() => {
                const detail = document.querySelector('.jsonl-detail');
                detail.focus();
                detail.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
            })()`);
      const opened = await page.waitFor(`!!document.querySelector('.jsonl-valuebar__scroll')`);
      expect(opened, "the error line got no value panel");
      const panel = json(
        await page.evaluate(`JSON.stringify({
                chars: document.querySelector('.jsonl-valuebar__scroll')?.textContent.length ?? 0,
                path: document.querySelector('.jsonl-valuebar__path')?.innerText ?? null,
            })`),
      );
      expect(panel.chars === 1_000_000, `error panel shows ${panel.chars} characters`);
      expect(panel.path === "L11", `error panel path is ${panel.path}`);
      return "too-large: 120-char body, 1,000,000-character panel";
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
                body: !!document.querySelector('.jsonl-valuebar__scroll'),
                preview: document.querySelector('.jsonl-valuebar__preview')?.innerText.length ?? 0,
                treePreview: [...document.querySelectorAll('.jsonl-val')]
                    .map(node => node.textContent.length)
                    .sort((a, b) => b - a)[0] ?? 0,
            })`),
      );
      expect(collapsed.path === "longValue", `value bar path is ${collapsed.path}`);
      expect(collapsed.expanded === "false", "the value panel opened on selection");
      expect(!collapsed.body, "the value panel rendered its body while collapsed");
      // 120 characters plus the `… (5,000 chars)` marker.
      expect(collapsed.treePreview <= 160, `tree preview is ${collapsed.treePreview} chars`);

      // The keyboard path: Enter on the focused tree/pane toggles the panel.
      await page.evaluate(`(() => {
                const detail = document.querySelector('.jsonl-detail');
                detail.focus();
                detail.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
            })()`);
      const expanded = await page.waitFor(`!!document.querySelector('.jsonl-valuebar__scroll')`);
      expect(expanded, "Enter did not expand the value panel");
      const state = json(
        await page.evaluate(`JSON.stringify({
                chars: document.querySelector('.jsonl-valuebar__scroll')?.textContent.length ?? 0,
                tail: document.querySelector('.jsonl-valuebar__scroll')?.textContent.slice(-4) ?? null,
                count: document.querySelector('.jsonl-valuebar__count')?.innerText ?? null,
                toggleLabel: document.querySelector('.jsonl-valuebar__toggle')?.getAttribute('aria-label'),
                chunks: document.querySelectorAll('.jsonl-valuebar__chunk').length,
            })`),
      );
      expect(state.chars === 5000, `value panel shows ${state.chars} characters`);
      expect(state.tail === "oong", `value panel tail is ${state.tail}`);
      expect(/5,000 characters/.test(state.count ?? ""), `value count is ${state.count}`);
      expect(state.chunks >= 1, `the panel rendered ${state.chunks} chunks`);
      // The panel is the only full-text channel, so it needs a way out of the 200px strip.
      await page.evaluate(`document.querySelector('.jsonl-valuebar__expand')?.click()`);
      const widened = await page.waitFor(
        `!!document.querySelector('.jsonl-valuebar__body--expanded')`,
      );
      expect(widened, "the expand toggle did not widen the panel");
      await page.evaluate(`document.querySelector('.jsonl-valuebar__expand')?.click()`);
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
                const text = document.querySelector('.jsonl-valuebar__scroll');
                text.focus();
                text.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            })()`);
      const restored = await page.waitFor(
        `document.activeElement?.classList.contains('jsonl-valuebar__toggle') && !document.querySelector('.jsonl-valuebar__scroll')`,
      );
      expect(restored, "Escape did not close the panel and restore focus to its toggle");
      return `tree ${collapsed.treePreview} chars, panel 5,000 chars in ${state.chunks} chunks, Enter/Ctrl+C/Escape/expand work`;
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
                body: document.querySelector('.jsonl-detail__error .jsonl-detail__raw')?.innerText.length ?? 0,
            })`),
      );
      expect(/too large/i.test(tree.warning ?? ""), `too-large chip is ${tree.warning}`);
      expect(/8\.0 MB/.test(tree.hint), `missing parse limit: ${tree.hint}`);
      expect(
        /Showing the first 120 characters — the full text is in the value panel/.test(tree.hint),
        `missing summary notice: ${tree.hint}`,
      );
      expect(tree.body === 120, `the error body is ${tree.body} chars, not the 120 summary`);
      // The raw view carries a counted notice; a silent cut was the bug.
      await page.evaluate(`[...document.querySelectorAll('.ant-segmented-item')]
                .find(node => node.innerText.trim() === 'Raw')
                ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
      const notice = await page.waitFor(
        `!!document.querySelector('.jsonl-detail__rawpane .jsonl-detail__notice')`,
      );
      expect(notice, "raw view hid the fact that its text is truncated");
      const raw = json(
        await page.evaluate(`JSON.stringify({
                text: document.querySelector('.jsonl-detail__rawpane .jsonl-detail__raw')?.innerText.length ?? 0,
                notice: document.querySelector('.jsonl-detail__rawpane .jsonl-detail__notice')?.innerText ?? null,
            })`),
      );
      expect(raw.text === 120, `raw view shipped ${raw.text} characters`);
      expect(/of 9,437,184 characters/.test(raw.notice ?? ""), `raw notice is ${raw.notice}`);
      return "8 MB hint + 120-char summary + counted notice in tree and raw";
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
      const opened = await page.waitFor(`!!document.querySelector('.jsonl-valuebar__scroll')`);
      expect(opened, "Enter did not expand the scalar value");
      const chars = await page.evaluate(
        `document.querySelector('.jsonl-valuebar__scroll')?.textContent.length ?? 0`,
      );
      expect(chars === 312, `scalar panel shows ${chars} characters`);
      return "scalar root: panel opens without a tree row, 312 chars";
    },
  },
  {
    name: "jsonl-raw-summary",
    async run({ page, base }) {
      await openJsonl(page, base);
      await jumpJsonl(page, 13);
      const ready = await page.waitFor(
        `document.querySelector('.jsonl-detail__index')?.innerText === 'L13' && !!document.querySelector('.jsonl-detail__tree')`,
      );
      expect(ready, "entry 13 never rendered");
      await page.evaluate(`[...document.querySelectorAll('.ant-segmented-item')]
                .find(node => node.innerText.trim() === 'Raw')
                ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
      const painted = await page.waitFor(
        `!!document.querySelector('.jsonl-detail__rawpane .jsonl-detail__raw')`,
      );
      expect(painted, "Raw did not render its summary");
      const state = json(
        await page.evaluate(`JSON.stringify({
                body: document.querySelector('.jsonl-detail__rawpane .jsonl-detail__raw')?.innerText.length ?? 0,
                notice: document.querySelector('.jsonl-detail__rawpane .jsonl-detail__notice')?.innerText ?? null,
                bar: !!document.querySelector('.jsonl-valuebar__toggle'),
            })`),
      );
      // Raw is a summary too (ADR-0030): the host ships the value, not the line.
      expect(state.body <= 121, `Raw painted ${state.body} characters, not the 120 summary`);
      expect(/of [\d,]+ characters/.test(state.notice ?? ""), `raw notice is ${state.notice}`);
      expect(state.bar, "the value bar is missing; the panel is the full-text channel");
      return `raw summary ${state.body} chars + counted notice`;
    },
  },
  {
    name: "jsonl-expand-lazy-array",
    async run({ page, base }) {
      await openJsonl(page, base, "dark", "&nested=1");
      const ready = await page.waitFor(`!!document.querySelector('.jsonl-detail__tree')`);
      expect(ready, "the nested transcript never rendered");
      const before = json(
        await page.evaluate(`JSON.stringify({
                    keys: [...document.querySelectorAll('.jsonl-detail__tree .jsonl-key')]
                        .map(node => node.textContent.trim()),
                    contentSwitcher: ([...document.querySelectorAll('.jsonl-detail__tree .ant-tree-treenode')]
                        .find(node => node.querySelector('.jsonl-key')?.textContent?.trim() === 'content')
                        ?.querySelector('.ant-tree-switcher')?.className) ?? null,
                })`),
      );
      // The record is small enough to auto-expand every key, so a depth-3 array must have its
      // children rendered — an expanded arrow over an empty subtree is the bug. `[0]`/`[1]`
      // appear twice: once under `messages`, once under `content`.
      const zeros = before.keys.filter((key) => key === "[0]").length;
      const ones = before.keys.filter((key) => key === "[1]").length;
      expect(
        zeros >= 2 && ones >= 2,
        `the expanded content array rendered no children: ${before.keys.join(", ")}`,
      );
      expect(
        (before.contentSwitcher ?? "").includes("switcher_open"),
        `content did not start expanded: ${before.contentSwitcher}`,
      );
      // Expand one child object; the second lazy level must load through the same path.
      const clicked = await page.evaluate(`(() => {
                const rows = [...document.querySelectorAll('.jsonl-detail__tree .ant-tree-treenode')];
                const contentAt = rows.findIndex(node =>
                    node.querySelector('.jsonl-key')?.textContent?.trim() === 'content');
                const row = rows.slice(contentAt + 1).find(node =>
                    node.querySelector('.jsonl-key')?.textContent?.trim() === '[0]'
                        && node.querySelector('.ant-tree-switcher_close'));
                row?.querySelector('.ant-tree-switcher_close')
                    ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                return !!row;
            })()`);
      expect(clicked, "content[0] was not rendered as a collapsed child");
      const fields = await page.waitFor(
        `[...document.querySelectorAll('.jsonl-detail__tree .jsonl-key')]
                    .some(node => node.textContent.trim() === 'image_url')`,
      );
      expect(fields, "expanding content[0] rendered no fields");
      const toggled = await page.evaluate(`(async () => {
                const row = [...document.querySelectorAll('.jsonl-detail__tree .ant-tree-treenode')]
                    .find(node => node.querySelector('.jsonl-key')?.textContent?.trim() === 'content');
                row?.querySelector('.ant-tree-switcher')
                    ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                await new Promise(resolve => setTimeout(resolve, 120));
                row?.querySelector('.ant-tree-switcher')
                    ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                return true;
            })()`);
      expect(toggled, "content could not be collapsed and expanded again");
      const again = await page.waitFor(
        `[...document.querySelectorAll('.jsonl-detail__tree .jsonl-key')]
                    .filter(node => node.textContent.trim() === '[0]').length >= 2`,
      );
      expect(again, "re-expanding content did not restore its children");
      return `expanded content shows its two children; content[0] exposes image_url`;
    },
  },
  {
    name: "jsonl-expand-lazy-node",
    async run({ page, base }) {
      await openJsonl(page, base);
      await jumpJsonl(page, 16);
      const ready = await page.waitFor(
        `document.querySelector('.jsonl-detail__index')?.innerText === 'L16' && !!document.querySelector('.jsonl-detail__tree')`,
      );
      expect(ready, "the dense entry never rendered");
      const clicked = await page.evaluate(`(() => {
                const row = [...document.querySelectorAll('.jsonl-detail__tree .ant-tree-treenode')]
                    .find(node => node.querySelector('.jsonl-key')?.textContent?.trim() === 'parameters'
                        && node.querySelector('.ant-tree-switcher_close'));
                const switcher = row?.querySelector('.ant-tree-switcher_close');
                switcher?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                return !!switcher;
            })()`);
      expect(clicked, "no collapsed lazy node named parameters was rendered");
      const loaded = await page.waitFor(
        `[...document.querySelectorAll('.jsonl-detail__tree .jsonl-key')]
                    .some(node => node.textContent.trim() === 'properties')`,
      );
      expect(loaded, "the clicked lazy node rendered no children");
      return "a clicked lazy node loads its children";
    },
  },
  {
    name: "jsonl-expansion-invariants",
    async run({ page, base }) {
      const probe = `(() => {
                const rows = [...document.querySelectorAll('.jsonl-detail__tree .ant-tree-treenode')];
                const read = (row) => ({
                    level: row.querySelectorAll('.ant-tree-indent-unit').length + 1,
                    key: row.querySelector('.jsonl-key')?.textContent?.trim() ?? '?',
                    open: !!row.querySelector('.ant-tree-switcher_open'),
                    loading: !!row.querySelector('.ant-tree-switcher-loading-icon'),
                    switcher: row.querySelector('.ant-tree-switcher')?.className ?? '',
                    type: row.querySelector('.jsonl-type')?.textContent ?? '',
                });
                const info = rows.map(read);
                const violations = [];
                for (let i = 0; i < info.length - 1; i++) {
                    const node = info[i];
                    if (!node.open || node.loading) continue;
                    if (info[i + 1].level <= node.level) violations.push(node.key + '@' + node.level);
                }
                // Under a screenful there is no virtual-list cut, so even the last row must not
                // be an open branch that ends the list.
                const last = info[info.length - 1];
                if (info.length < 20 && last && last.open && !last.loading &&
                    !/array\\[0\\]|object\\{0\\}/.test(last.type)) {
                    violations.push(last.key + '@' + last.level + ':last');
                }
                return JSON.stringify({
                    rows: info.length,
                    keys: info.map((node) => node.key),
                    violations,
                    emptyOpen: info.filter((node) =>
                        node.open && /array\\[0\\]|object\\{0\\}/.test(node.type)).length,
                    emptySwitchers: info.filter((node) =>
                        /^(emptyArray|emptyObject)$/.test(node.key) && !node.switcher.includes('noop')).length,
                });
            })()`;
      const reports = [];
      await openJsonl(page, base, "dark", "&edge=1");
      for (let index = 0; index < 3; index++) {
        if (index > 0) await jumpJsonl(page, index + 1);
        const ready = await page.waitFor(`!!document.querySelector('.jsonl-detail__tree')`);
        expect(ready, `edge entry ${index} never rendered`);
        await page.sleep(900);
        const report = json(await page.evaluate(probe));
        expect(
          report.violations.length === 0,
          `edge entry ${index}: open rows with no child rows: ${JSON.stringify(report.violations)} (keys: ${report.keys.join(", ")})`,
        );
        expect(
          report.emptyOpen === 0,
          `edge entry ${index}: empty composites offered an expand arrow (${report.emptyOpen})`,
        );
        if (index === 1) {
          expect(report.emptySwitchers === 0, "empty composites still rendered an expand switcher");
        }
        reports.push(`edge-${index}: ${report.rows} rows [${report.keys.join(", ")}]`);
      }
      // Same invariant on the everyday fixtures, not only the synthetic edge shapes.
      await openJsonl(page, base);
      const dense = await page.waitFor(
        `document.querySelector('.jsonl-detail__index')?.innerText === 'L1' && !!document.querySelector('.jsonl-detail__tree')`,
      );
      expect(dense, "the default fixture never rendered");
      await page.sleep(700);
      const everyday = json(await page.evaluate(probe));
      expect(
        everyday.violations.length === 0,
        `default entry: open rows with no child rows: ${JSON.stringify(everyday.violations)}`,
      );
      await jumpJsonl(page, 16);
      await page.waitFor(`document.querySelector('.jsonl-detail__index')?.innerText === 'L16'`);
      await page.sleep(900);
      const heavy = json(await page.evaluate(probe));
      expect(
        heavy.violations.length === 0,
        `dense entry: open rows with no child rows: ${JSON.stringify(heavy.violations)} (keys: ${heavy.keys.join(", ")})`,
      );
      reports.push(`default: ${everyday.rows} rows`, `dense: ${heavy.rows} rows`);

      // The 200-child cap: the overflow row has to exist and stay a leaf.
      await openJsonl(page, base, "dark", "&edge=1");
      await page.evaluate(`(async () => {
                const holder = document.querySelector('.jsonl-detail__tree .ant-tree-list-holder');
                if (!holder) return;
                for (let i = 0; i < 6; i++) {
                    holder.scrollTop = holder.scrollHeight;
                    await new Promise((resolve) => setTimeout(resolve, 150));
                }
            })()`);
      const more = await page.evaluate(
        `document.querySelector('.jsonl-detail__tree .jsonl-more')?.innerText ?? null`,
      );
      expect(/60 more keys/.test(more ?? ""), `wide array overflow row is ${more}`);

      // A fourth-level lazy node loads like the others when clicked.
      await jumpJsonl(page, 3);
      await page.waitFor(`document.querySelector('.jsonl-detail__index')?.innerText === 'L3'`);
      const deepClick = await page.evaluate(`(() => {
                const row = [...document.querySelectorAll('.jsonl-detail__tree .ant-tree-treenode')]
                    .find((node) => node.querySelector('.jsonl-key')?.textContent?.trim() === 'l3'
                        && node.querySelector('.ant-tree-switcher_close'));
                row?.querySelector('.ant-tree-switcher_close')
                    ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                return !!row;
            })()`);
      expect(deepClick, "the fourth-level lazy row was not collapsed");
      const bottom = await page.waitFor(
        `[...document.querySelectorAll('.jsonl-detail__tree .jsonl-key')]
                    .some((node) => node.textContent.trim() === 'l4')`,
      );
      expect(bottom, "the fourth-level lazy node rendered no child");
      reports.push("wide overflow + fourth-level lazy node ok");
      return reports.join(" · ");
    },
  },
  {
    name: "jsonl-search-marks-loaded-lazy-values",
    async run({ page, base }) {
      await openJsonl(page, base, "dark", "&edge=1");
      await jumpJsonl(page, 4);
      const ready = await page.waitFor(
        `document.querySelector('.jsonl-detail__index')?.innerText === 'L4' && !!document.querySelector('.jsonl-detail__tree')`,
      );
      expect(ready, "the long-string entry never rendered");
      // deep (depth 3) is lazy; its child long arrives before there is any search term.
      const loaded = await page.waitFor(
        `[...document.querySelectorAll('.jsonl-detail__tree .jsonl-key')]
                    .some((node) => node.textContent.trim() === 'long')`,
      );
      expect(loaded, "the lazy node never loaded its long-string child");
      const before = await page.evaluate(
        `document.querySelector('.jsonl-detail__tree')?.innerText.includes('needle-marker') ?? false`,
      );
      expect(!before, "the 120-character summary unexpectedly includes the tail marker");
      await page.evaluate(setInput(".jsonl-search input", "needle-marker"));
      const marked = await page.waitFor(
        `[...document.querySelectorAll('.jsonl-detail__tree mark.jsonl-hit')]
                    .some((mark) => (mark.textContent ?? '').includes('needle-marker'))`,
      );
      expect(marked, "searching a value inside an already-loaded lazy node rendered no hit");
      return "a value loaded before the search is re-marked and re-centred";
    },
  },
  {
    name: "jsonl-frames-select",
    async run({ page, base }) {
      await openJsonl(page, base, "dark", "&many=300");
      const ready = await page.waitFor(
        `document.querySelectorAll('.jsonl-index__tree .ant-tree-treenode').length >= 20`,
      );
      expect(ready, "the directory rendered fewer than 20 rows");
      await page.clearFrames();
      const switches = await page.evaluate(`(async () => {
                const rows = [...document.querySelectorAll('.jsonl-index__tree .ant-tree-treenode')];
                const targets = rows.slice(0, 20);
                for (const row of targets) {
                    row.querySelector('.ant-tree-node-content-wrapper')
                        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                    await new Promise((resolve) => setTimeout(resolve, 60));
                }
                return targets.length;
            })()`);
      expect(switches === 20, `only ${switches} directory rows were clicked`);
      return describeFrames(
        summarizeFrames(await framesOf(page), "20 entry switches"),
        "Entry switches rebuild the detail tree and stringify the selected value; check the lazy depth and the detail payload.",
      );
    },
  },
  {
    name: "jsonl-frames-expand",
    async run({ page, base }) {
      await openJsonl(page, base);
      await jumpJsonl(page, 16);
      const ready = await page.waitFor(
        `document.querySelector('.jsonl-detail__index')?.innerText === 'L16' && !!document.querySelector('.jsonl-detail__tree')`,
      );
      expect(ready, "the dense entry never rendered");
      await page.clearFrames();
      const expanded = await page.evaluate(`(async () => {
                const switchers = [...document.querySelectorAll('.jsonl-detail__tree .ant-tree-switcher_close')];
                const targets = switchers.slice(0, 3);
                for (const switcher of targets) {
                    switcher.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                    await new Promise((resolve) => setTimeout(resolve, 150));
                }
                return targets.length;
            })()`);
      expect(expanded > 0, "the dense entry rendered no collapsed subtree");
      return describeFrames(
        summarizeFrames(await framesOf(page), `expand ${expanded} subtree(s)`),
        "Expanding builds the sub-model and loads children; check lazyDepth and the child count budget.",
      );
    },
  },
  {
    name: "jsonl-frames-panel",
    async run({ page, base }) {
      await openJsonl(page, base);
      await jumpJsonl(page, 14);
      await page.evaluate(`(() => {
                const row = [...document.querySelectorAll('.jsonl-detail__tree .ant-tree-treenode')]
                    .find(node => node.innerText.startsWith('longValue'));
                row?.querySelector('.ant-tree-node-content-wrapper')
                    ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            })()`);
      const bar = await page.waitFor(`!!document.querySelector('.jsonl-valuebar__toggle')`);
      expect(bar, "selecting a long string did not open the value bar");
      await page.clearFrames();
      await page.evaluate(`(() => {
                const detail = document.querySelector('.jsonl-detail');
                detail.focus();
                detail.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
            })()`);
      const opened = await page.waitFor(`!!document.querySelector('.jsonl-valuebar__scroll')`);
      expect(opened, "the value panel did not open");
      await page.sleep(120);
      return describeFrames(
        summarizeFrames(await framesOf(page), "value panel open (5,000 chars)"),
        "Opening the panel stringifies the value and lays out its chunks; check jsonTextBounded and chunkText.",
      );
    },
  },
];
