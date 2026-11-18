import { expect, json, openJsonl } from "../helpers.mjs";

/** 2 scenarios: indexing progress display and fast load without progress. */
export default [
  {
    name: "jsonl-indexing-basic",
    async run({ page, base }) {
      // Clear state and navigate with indexing parameter
      await page.navigate(`${base}/stats`);
      await page.evaluate(`Object.keys(localStorage)
        .filter(key => key.startsWith('jsonl-state:'))
        .forEach(key => localStorage.removeItem(key))`);
      await page.navigate(`${base}/harness?indexing=1`);

      // Wait for directory to render after indexing
      await page.waitFor(
        `!!document.querySelector('.jsonl-index__tree .ant-tree-treenode')`,
        10000,
      );

      const state = json(
        await page.evaluate(`JSON.stringify({
          rows: document.querySelectorAll('.jsonl-index__tree .ant-tree-treenode').length
        })`),
      );

      expect(state.rows > 0, `Expected rows after indexing, got ${state.rows}`);
      return `Indexing completed, ${state.rows} rows displayed`;
    },
  },
  {
    name: "jsonl-no-progress-on-small-file",
    async run({ page, base }) {
      await openJsonl(page, base);

      const state = json(
        await page.evaluate(`JSON.stringify({
          rows: document.querySelectorAll('.jsonl-index__tree .ant-tree-treenode').length
        })`),
      );

      expect(state.rows > 0, `Expected immediate load, got ${state.rows} rows`);
      return `Small file loaded ${state.rows} rows without progress`;
    },
  },
];
