import { expect, json, openJson, setInput } from "../helpers.mjs";

/** Command-opened JSON preview: records, search, object roots, and the non-happy states. */
export default [
  {
    name: "json-records",
    docs: "json-records.png",
    async run({ page, base }) {
      await openJson(page, base);
      const treeReady = await page.waitFor(`!!document.querySelector('.jsonl-detail__tree')`);
      expect(treeReady, "record 0 never rendered its tree");
      const initial = json(
        await page.evaluate(`JSON.stringify({
          file: document.querySelector('.jsonl-file-name')?.innerText ?? null,
          meta: document.querySelector('.jsonl-meta')?.innerText ?? null,
          rows: document.querySelectorAll('.json-record').length,
          first: document.querySelector('.json-record')?.innerText ?? null,
          index: document.querySelector('.jsonl-detail__index')?.innerText ?? null,
          tree: !!document.querySelector('.jsonl-detail__tree'),
          actionInBottomBar: !!document.querySelector('.jsonl-bottombar .jsonl-detail__header'),
        })`),
      );
      expect(initial.file === "records.json", `unexpected file name: ${initial.file}`);
      expect(/5 records/.test(initial.meta ?? ""), `missing record count: ${initial.meta}`);
      expect(initial.rows >= 5, `record rail rendered ${initial.rows} rows`);
      expect(/\[0\]/.test(initial.first ?? ""), `first row has no index: ${initial.first}`);
      expect(initial.index === "[0]", `unexpected first selection: ${initial.index}`);
      expect(initial.tree, "record 0 rendered no tree");
      expect(initial.actionInBottomBar, "detail actions are not in the bottom bar");

      await page.evaluate(`document.querySelectorAll('.json-record')[2]?.dispatchEvent(
        new MouseEvent('click', { bubbles: true }))`);
      const moved = await page.waitFor(`(() => {
        const index = document.querySelector('.jsonl-detail__index')?.innerText;
        return index === '[2]' && !!document.querySelector('.jsonl-detail__tree');
      })()`);
      expect(moved, "selecting record 2 did not load its tree");
      return `${initial.rows} visible rows, ${initial.meta}`;
    },
  },
  {
    name: "json-record-search-highlight",
    docs: "json-search.png",
    async run({ page, base }) {
      await openJson(page, base);
      await page.evaluate(setInput(".jsonl-search input", "alpha"));
      const status = await page.waitFor(
        `!!document.querySelector('.json-search-row') || !!document.querySelector('.jsonl-search-status')`,
      );
      expect(status, "search rail never rendered");
      const settled = await page.waitFor(`(() => {
        const rows = document.querySelectorAll('.json-search-row').length;
        const text = document.querySelector('.jsonl-search-status')?.innerText ?? '';
        return rows > 0 && /match/.test(text) && !text.includes('Searching');
      })()`);
      expect(settled, "search results never settled");
      const before = json(
        await page.evaluate(
          `JSON.stringify({ rows: document.querySelectorAll('.json-search-row').length, status: document.querySelector('.jsonl-search-status')?.innerText ?? null })`,
        ),
      );
      expect(before.rows >= 1, `no search result rows: ${before.rows}`);
      await page.evaluate(
        `document.querySelector('.json-search-row')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))`,
      );
      const highlighted = await page.waitFor(
        `document.querySelectorAll('.jsonl-detail__tree .jsonl-hit').length > 0`,
      );
      expect(highlighted, "selecting a search result did not highlight the tree");
      const state = json(
        await page.evaluate(`JSON.stringify({
          index: document.querySelector('.jsonl-detail__index')?.innerText ?? null,
          hits: document.querySelectorAll('.jsonl-detail__tree .jsonl-hit').length,
          selected: document.querySelectorAll('.ant-tree-node-selected').length,
        })`),
      );
      expect(state.index === "[0]", `unexpected selected record: ${state.index}`);
      expect(state.hits > 0, "no marks in the detail tree");
      expect(state.selected > 0, "the matching row was not selected");
      return `${before.rows} result rows, ${state.hits} marks`;
    },
  },
  {
    name: "json-record-list-is-virtual",
    async run({ page, base }) {
      await openJson(page, base, "array", "&records=500");
      const initial = await page.evaluate(`document.querySelectorAll('.json-record').length`);
      expect(initial > 0 && initial < 100, `record rail rendered ${initial} rows for 500 records`);
      await page.evaluate(`(() => {
        const list = document.querySelector('.json-record-list');
        if (!list) return;
        list.scrollTop = 400 * 28;
        list.dispatchEvent(new Event('scroll', { bubbles: false }));
      })()`);
      const scrolled = await page.waitFor(`!![...document.querySelectorAll('.json-record')]
        .find(row => (row.innerText || '').includes('[400]'))`);
      expect(scrolled, "record 400 never rendered after scrolling");
      const count = await page.evaluate(`document.querySelectorAll('.json-record').length`);
      expect(count < 100, `virtual list rendered ${count} rows after scrolling`);
      return `${initial} initial rows, ${count} after scroll`;
    },
  },
  {
    name: "json-object-root-search",
    async run({ page, base }) {
      await openJson(page, base, "object");
      const mounted = await page.waitFor(`!!document.querySelector('.jsonl-detail__tree')`);
      expect(mounted, "object root rendered no tree");
      const railBefore = await page.evaluate(`!!document.querySelector('.json-record-list')`);
      expect(!railBefore, "object root wrongly rendered a record rail");
      await page.evaluate(setInput(".jsonl-search input", "get"));
      const rows = await page.waitFor(`document.querySelectorAll('.json-search-row').length > 0`);
      expect(rows, "object-root search rendered no paths");
      await page.evaluate(
        `document.querySelector('.json-search-row')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))`,
      );
      const highlighted = await page.waitFor(
        `document.querySelectorAll('.jsonl-detail__tree .jsonl-hit').length > 0`,
      );
      expect(highlighted, "object-root path result did not highlight the tree");
      const state = json(
        await page.evaluate(
          `JSON.stringify({ rows: document.querySelectorAll('.json-search-row').length, hits: document.querySelectorAll('.jsonl-detail__tree .jsonl-hit').length })`,
        ),
      );
      expect(state.hits > 0, "no object-root marks");
      return `${state.rows} paths, ${state.hits} marks`;
    },
  },
  {
    name: "json-buffer-label",
    async run({ page, base }) {
      await openJson(page, base, "array", "&buffer=1");
      const label = await page.evaluate(
        `document.querySelector('.json-buffer')?.innerText ?? null`,
      );
      expect(/unsaved editor buffer/i.test(label ?? ""), `unexpected buffer label: ${label}`);
      return label;
    },
  },
  {
    name: "json-invalid-state",
    async run({ page, base }) {
      await openJson(page, base, "invalid");
      const state = json(
        await page.evaluate(`JSON.stringify({
          title: document.querySelector('.json-preview__state-title')?.innerText ?? null,
          text: document.querySelector('.json-preview__state')?.innerText ?? null,
          records: document.querySelectorAll('.json-record').length,
        })`),
      );
      expect(state.title === "invalid JSON", `unexpected invalid title: ${state.title}`);
      expect(/line 3, column 7/.test(state.text ?? ""), `missing line/column: ${state.text}`);
      expect(state.records === 0, "an invalid root rendered records");
      return state.title;
    },
  },
  {
    name: "json-too-large-state",
    async run({ page, base }) {
      await openJson(page, base, "too-large");
      const state = json(
        await page.evaluate(`JSON.stringify({
          title: document.querySelector('.json-preview__state-title')?.innerText ?? null,
          text: document.querySelector('.json-preview__state')?.innerText ?? null,
        })`),
      );
      expect(/too large/.test(state.title ?? ""), `unexpected too-large title: ${state.title}`);
      expect(
        /100/.test(state.text ?? "") && /20/.test(state.text ?? ""),
        `limits missing: ${state.text}`,
      );
      return state.title;
    },
  },
  {
    name: "json-empty-array",
    async run({ page, base }) {
      await openJson(page, base, "empty");
      const state = json(
        await page.evaluate(`JSON.stringify({
          title: document.querySelector('.json-preview__state-title')?.innerText ?? null,
          records: document.querySelectorAll('.json-record').length,
        })`),
      );
      expect(state.title === "No records", `unexpected empty title: ${state.title}`);
      expect(state.records === 0, "empty array rendered record rows");
      return state.title;
    },
  },
];
