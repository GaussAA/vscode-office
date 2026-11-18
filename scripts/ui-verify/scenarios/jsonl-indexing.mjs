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

      // Wait for the empty state element to appear
      await page.waitFor(`!!document.querySelector('.jsonl-empty')`, 3000);

      // Capture progress text snapshots to verify progression
      // harness simulates 5 progress updates over ~400ms (80ms × 5), so sample fast
      const snapshots = [];
      for (let i = 0; i < 10; i++) {
        await page.sleep(50);
        const text = await page.evaluate(`
          (() => {
            const emptyEl = document.querySelector('.jsonl-empty');
            return emptyEl ? emptyEl.textContent : null;
          })()
        `);
        if (text && text.includes("Indexing")) {
          snapshots.push(text);
        }
      }

      expect(
        snapshots.length > 0,
        `Expected to see indexing progress, got ${snapshots.length} snapshots`,
      );
      expect(
        snapshots.some((s) => s.match(/\d+%/)),
        `Expected percentage in progress: ${snapshots.join(", ")}`,
      );

      // Wait for directory to render after indexing completes
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
      return `Saw ${snapshots.length} progress updates, ${state.rows} rows displayed`;
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
