import { expect, json, jumpJsonl, openEmptyJsonl, openJsonl, unexpected } from "../helpers.mjs";

/** 8 scenario(s); the runner concatenates these lists. */
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
      expect(state.raw > 0 && state.raw < 1000, `too-large raw text is ${state.raw} chars`);
      return "too-large line: warn chip, truncated raw text";
    },
  },
];
