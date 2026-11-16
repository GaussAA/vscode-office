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
  {
    name: "compare-reload-stale-reply-dropped",
    async run({ page, base }) {
      // Compare issues one `compareReload` on mount; there is no reload button. Using `?hold=`
      // to queue the real reply so the Loading state persists long enough to inject a stale one.
      await page.navigate(`${base}/harness-route?route=compare&case=same-schema&hold=compareData`);
      const asked = await page.waitFor(`window.__bridge.sentCount('compareReload') === 1`, 3000);
      expect(asked, "compareReload was never sent");
      const queued = await page.waitFor(`window.__bridge.queued('compareData') === 1`, 3000);
      expect(queued, "the real compareData reply was not held");
      const loading = await page.evaluate(
        `document.querySelector('.compare-view')?.innerText.includes('Loading') ?? false`,
      );
      expect(loading, "compare view is not showing Loading while the response is held");

      // Inject a stale reply with requestId 0 (stub uses id from request, which is 1)
      await page.evaluate(`
        window.dispatchEvent(new MessageEvent('message', { data: {
          type: 'compareData',
          content: {
            requestId: 0,
            compare: {
              left: { fileName: 'STALE-left.parquet', rowCount: 1, rowGroupCount: 1, columnCount: 1, hasAnyStatistics: true },
              right: { fileName: 'STALE-right.parquet', rowCount: 1, rowGroupCount: 1, columnCount: 1, hasAnyStatistics: true },
              rowCountDelta: 0,
              columns: [],
              summary: { same: 0, changed: 0, added: 0, removed: 0, 'type-changed': 0, uncomparable: 0 },
            },
          },
        }}));
      `);
      await new Promise((resolve) => setTimeout(resolve, 250));

      // The view should still be loading, not showing the stale data
      const stillLoading = await page.evaluate(
        `document.querySelector('.compare-view')?.innerText.includes('Loading') ?? false`,
      );
      expect(stillLoading, "the view accepted the stale reply with requestId 0");

      // Release the real reply
      await page.evaluate(`window.__bridge.release('compareData')`);
      const rendered = await page.waitFor(`!!document.querySelector('.compare-group-title')`, 5000);
      expect(rendered, "the real compare data never rendered");
      const title = await page.evaluate(
        `document.querySelector('.compare-view')?.innerText.slice(0, 200)`,
      );
      expect(!title.includes("STALE"), `the title shows stale data: ${title}`);
      return "stale reply with requestId 0 was dropped; real reply (id 1) rendered";
    },
  },
];
