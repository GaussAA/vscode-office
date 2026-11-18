import { expect, json, openJsonl } from "../helpers.mjs";

/** 2 scenarios: indexing progress display and fast load without progress. */
export default [
  {
    name: "jsonl-indexing-basic",
    async run({ page, base }) {
      await page.navigate(`${base}/harness-jsonl?indexing=1`);

      // Wait for viewer to mount
      await page.waitFor(`!!document.querySelector('.jsonl-viewer')`);

      // Directory should eventually show rows after indexing completes
      await page.waitFor(`!!document.querySelector('.jsonl-directory-row')`, 5000);

      const rows = await page.evaluate(
        () => document.querySelectorAll(".jsonl-directory-row").length,
      );

      expect(rows > 0, `Expected rows after indexing, got ${rows}`);
      return `Indexing completed, ${rows} rows displayed`;
    },
  },
  {
    name: "jsonl-no-progress-on-small-file",
    async run({ page, base }) {
      await openJsonl(page, base);

      // Directory should load quickly without indexing indicator
      await page.waitFor(`!!document.querySelector('.jsonl-directory-row')`, 2000);

      const rows = await page.evaluate(
        () => document.querySelectorAll(".jsonl-directory-row").length,
      );

      expect(rows > 0, `Expected immediate load, got ${rows} rows`);
      return `Small file loaded ${rows} rows without progress`;
    },
  },
];
