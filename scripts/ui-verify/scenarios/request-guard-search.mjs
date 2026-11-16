import { expect, json, openJsonl, openJson, setInput } from "../helpers.mjs";

/**
 * A new search must cancel the old one and the old batch must not render.
 *
 * `?hold=` queues every search batch the fake host posts, so the first query's batch is still on
 * the wire when the second query replaces it. That is the real shape of the race: the host
 * cannot un-send a batch that is already in flight.
 *
 * Mutation: make `RequestGuard.isCurrent` always return true (src/react/util/requestGuard.ts).
 */
export default [
  {
    name: "jsonl-search-new-query-cancels-old",
    async run({ page, base }) {
      await openJsonl(page, base, "dark", "&hold=jsonlSearchBatch");
      const type = (text) => page.evaluate(setInput(".jsonl-search input", text));
      await type("alpha");
      const first = await page.waitFor(`window.__bridge.sentCount('jsonlSearch') === 1`, 5000);
      expect(first, "the first search was never sent");
      const queued = await page.waitFor(`window.__bridge.queued('jsonlSearchBatch') >= 1`, 5000);
      expect(queued, "the first search's batch was not held on the wire");
      const firstId = await page.evaluate(`window.__bridge.sentOf('jsonlSearch')[0].requestId`);

      await type("unicode");
      const second = await page.waitFor(`window.__bridge.sentCount('jsonlSearch') === 2`, 5000);
      expect(second, "the second search was never sent");
      const cancels = json(
        await page.evaluate(
          `JSON.stringify(window.__bridge.sentOf('jsonlSearchCancel').map(m => m.requestId))`,
        ),
      );
      expect(
        cancels.length === 1 && cancels[0] === firstId,
        `expected one cancel for request ${firstId}, got ${JSON.stringify(cancels)}`,
      );

      await page.evaluate(`window.__bridge.release('jsonlSearchBatch')`);
      const settled = await page.waitFor(`(() => {
        const text = document.querySelector('.jsonl-search-status')?.innerText ?? '';
        return /\\d+ match/.test(text) && !text.includes('Searching');
      })()`);
      expect(settled, "the second search never settled");
      await new Promise((resolve) => setTimeout(resolve, 250));
      const state = json(
        await page.evaluate(`JSON.stringify({
          status: document.querySelector('.jsonl-search-status')?.innerText ?? null,
          rows: document.querySelectorAll('.jsonl-index__tree .ant-tree-treenode:not([aria-hidden])').length,
          text: document.querySelector('.jsonl-index__tree')?.innerText ?? '',
        })`),
      );
      expect(/^1 match/.test(state.status ?? ""), `status is ${state.status}`);
      expect(state.rows === 1, `the stale batch rendered: ${state.rows} rows (${state.text})`);
      return `one cancel for request ${firstId}; only the "unicode" result rendered`;
    },
  },
  {
    name: "json-search-new-query-cancels-old",
    async run({ page, base }) {
      await openJson(page, base, "array", "&hold=jsonSearchBatch");
      const type = (text) => page.evaluate(setInput(".jsonl-search input", text));
      await type("alpha");
      const first = await page.waitFor(`window.__bridge.sentCount('jsonSearch') === 1`, 5000);
      expect(first, "the first search was never sent");
      const queued = await page.waitFor(`window.__bridge.queued('jsonSearchBatch') >= 1`, 5000);
      expect(queued, "the first search's batch was not held on the wire");
      const firstId = await page.evaluate(`window.__bridge.sentOf('jsonSearch')[0].requestId`);

      await type("gamma");
      const second = await page.waitFor(`window.__bridge.sentCount('jsonSearch') === 2`, 5000);
      expect(second, "the second search was never sent");
      const cancels = json(
        await page.evaluate(
          `JSON.stringify(window.__bridge.sentOf('jsonSearchCancel').map(m => m.requestId))`,
        ),
      );
      expect(
        cancels.length >= 1 && cancels[0] === firstId,
        `expected a cancel for request ${firstId}, got ${JSON.stringify(cancels)}`,
      );

      await page.evaluate(`window.__bridge.release('jsonSearchBatch')`);
      const settled = await page.waitFor(`(() => {
        const text = document.querySelector('.jsonl-search-status')?.innerText ?? '';
        return document.querySelectorAll('.json-search-row').length > 0 && !text.includes('Searching');
      })()`);
      expect(settled, "the second search never produced rows");
      await new Promise((resolve) => setTimeout(resolve, 250));
      const rows = json(
        await page.evaluate(
          `JSON.stringify([...document.querySelectorAll('.json-search-row')].map(n => n.innerText))`,
        ),
      );
      expect(
        rows.length === 1 && /gamma/i.test(rows[0]),
        `the stale batch rendered: ${JSON.stringify(rows)}`,
      );
      return `cancel for request ${firstId}; only the "gamma" result rendered`;
    },
  },
];
