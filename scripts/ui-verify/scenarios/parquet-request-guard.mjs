import { ROWS, expect, json, openParquet, pageSize, pagerState, rangeOf } from "../helpers.mjs";

/**
 * Scenarios for the RequestGuard fix (commit fd6a63e0). Each documents the mutation that would
 * break it.
 *
 * Mutation M1 (parquet-open-once): add `paging.pageSize` to loadParquet's useCallback deps in Parquet.tsx.
 * Mutation M2 (parquet-restore-first-measure): remove `|| this.restorePending` from
 * Session.fitPageSize's same-size skip condition in parquetSession.ts.
 */
export default [
  {
    name: "parquet-open-once",
    async run({ page, base }) {
      await openParquet(page, base, "?mixed=1&profile=1");
      const size = await pageSize(page);
      const state = await pagerState(page);
      expect(state.range === rangeOf(size, 0, 300), `range: ${state.range}`);

      // Check profile badges rendered (4 columns with nulls)
      const badges = await page.evaluate(
        `document.querySelectorAll('.parquet-viewer__list-null').length`,
      );
      expect(badges === 4, `expected 4 badges, got ${badges}`);

      // Baseline: init and parquetProfile each sent exactly once
      const counts = json(
        await page.evaluate(`JSON.stringify(window.__bridge?.sentCount ? {
          init: window.__bridge.sentCount('init'),
          profile: window.__bridge.sentCount('parquetProfile'),
        } : null)`),
      );
      expect(counts !== null, "bridge not present");
      expect(counts.init === 1, `init fired ${counts.init} times, expected 1`);
      expect(counts.profile === 1, `profile sent ${counts.profile} times, expected 1`);

      return `opened once: init=${counts.init}, profile=${counts.profile}, badges=${badges}`;
    },
  },
  {
    name: "parquet-restore-first-measure",
    async run({ page, base }) {
      // `openParquet` wipes every `parquet-state:` key, so it cannot be used to start from a
      // seeded one: clear, seed, then navigate straight to the viewer.
      await page.navigate(`${base}/stats`);
      await page.evaluate(`(() => {
        Object.keys(localStorage)
          .filter(key => key.startsWith('parquet-state:') || key === 'parquet-sider-width')
          .forEach(key => localStorage.removeItem(key));
        localStorage.setItem('parquet-state:/mixed.parquet', JSON.stringify({ row: 100 }));
      })()`);
      await page.navigate(`${base}/harness-parquet?mixed=1`);
      const mounted = await page.waitFor(
        `!!document.querySelector('.parquet-table .ant-table-row') && Number(document.querySelector('.parquet-viewer__table-wrap')?.dataset.pageSize ?? 0) > 0`,
      );
      expect(mounted, "parquet table did not render");

      const size = await pageSize(page);
      const expectedPage = Math.floor(100 / size);
      const expectedRange = rangeOf(size, expectedPage, 300);
      const expectedFirst = String(expectedPage * size + 1);
      // The restore is applied by the first measurement, so wait for the page it should land on
      // (rows included: the pager text moves before the cells do).
      const restored = await page.waitFor(
        `document.querySelector('.parquet-viewer__pager-info')?.innerText === ${JSON.stringify(expectedRange)}` +
          ` && (${ROWS}[0])?.children[0]?.innerText === ${JSON.stringify(expectedFirst)}`,
        8000,
      );
      const state = await pagerState(page);
      expect(
        restored,
        `row 100 was not restored on the first measure: expected ${expectedRange} / row ${expectedFirst}, got ${state.range} / row ${state.first}`,
      );
      return `row 100 restored to ${state.range} (page size ${size})`;
    },
  },
  {
    name: "parquet-restore-first-measure-min-viewport",
    async run({ page, base, setViewport }) {
      // Root cause 2 only manifests when measured page size equals MIN_ROWS_PER_PAGE (8).
      // Default viewport produces ~21, so the same-size skip never triggers. Height 400
      // produces exactly 8 rows, exercising the edge case where fitPageSize would skip.
      await setViewport(1500, 400);

      await page.navigate(`${base}/stats`);
      await page.evaluate(`(() => {
        Object.keys(localStorage)
          .filter(key => key.startsWith('parquet-state:') || key === 'parquet-sider-width')
          .forEach(key => localStorage.removeItem(key));
        localStorage.setItem('parquet-state:/mixed.parquet', JSON.stringify({ row: 100 }));
      })()`);

      await page.navigate(`${base}/harness-parquet?mixed=1`);
      const mounted = await page.waitFor(
        `!!document.querySelector('.parquet-table .ant-table-row') && Number(document.querySelector('.parquet-viewer__table-wrap')?.dataset.pageSize ?? 0) > 0`,
      );
      expect(mounted, "table did not render");

      const size = await pageSize(page);
      expect(size === 8, `precondition: pageSize is ${size}, expected 8`);

      // With pageSize=8, row 100 lands on page 12 (rows 97-104)
      const expectedPage = 12;
      const expectedRange = rangeOf(8, expectedPage, 300);
      const expectedFirst = "97";

      const restored = await page.waitFor(
        `document.querySelector('.parquet-viewer__pager-info')?.innerText === ${JSON.stringify(expectedRange)}` +
          ` && (${ROWS}[0])?.children[0]?.innerText === ${JSON.stringify(expectedFirst)}`,
        8000,
      );
      const state = await pagerState(page);
      expect(
        restored,
        `row 100 not restored: expected ${expectedRange}/row ${expectedFirst}, got ${state.range}/row ${state.first}`,
      );

      return `row 100 restored at pageSize=8: ${state.range}`;
    },
  },
  {
    name: "parquet-document-switch-stale-scan",
    async run({ page, base }) {
      // The host answers the column scan only when told to: `?hold=` queues that reply type.
      await openParquet(page, base, "?mixed=1&profile=1&hold=parquetColumnScanData");
      const profiled = await page.waitFor(
        `document.querySelectorAll('.parquet-viewer__list-null').length === 4`,
      );
      expect(profiled, "the profile badges never rendered");
      await page.evaluate(`document.querySelectorAll('.parquet-viewer__list-null')[1].click()`);
      const opened = await page.waitFor(`!!document.querySelector('.parquet-viewer__profile')`);
      expect(opened, "clicking a badge did not open the panel");

      // Click "Scan this column" to trigger the scan request
      await page.evaluate(
        `[...document.querySelectorAll('.parquet-viewer__profile button')].find(b => b.textContent === 'Scan this column')?.click()`,
      );
      const asked = await page.waitFor(
        `window.__bridge.sentCount('parquetColumnScan') === 1`,
        3000,
      );
      expect(asked, "scan button did not trigger a scan request");
      // The fake host answers 40 ms after the request; wait for the reply to reach the queue.
      const held = await page.waitFor(
        `window.__bridge.queued('parquetColumnScanData') === 1`,
        3000,
      );
      const waiting = await page.evaluate(`window.__bridge.queued('parquetColumnScanData')`);
      expect(held, `expected the scan reply to be held, ${waiting} queued`);

      // Same webview, another document; the old scan is still unanswered.
      await page.evaluate(
        `window.__bridge.deliver('open', { path: '/sample.parquet', fileName: 'second.parquet', documentCacheId: 'demo-second' })`,
      );
      const reopened = await page.waitFor(
        `!!document.querySelector('.parquet-table .ant-table-row') && !document.querySelector('.parquet-viewer__overlay')`,
      );
      expect(reopened, "the second document never rendered");
      const reset = await page.evaluate(`!document.querySelector('.parquet-viewer__profile')`);
      expect(reset, "the column panel survived the document switch");

      // Now the first document's reply arrives.
      await page.evaluate(`window.__bridge.release('parquetColumnScanData')`);
      const delivered = await page.waitFor(
        `window.__bridge.deliveredOf('parquetColumnScanData').length === 1`,
      );
      expect(delivered, "the held scan reply was never delivered");
      await new Promise((resolve) => setTimeout(resolve, 250));
      const after = json(
        await page.evaluate(`JSON.stringify({
          panel: !!document.querySelector('.parquet-viewer__profile'),
          rows: document.querySelectorAll('.parquet-viewer__profile-row').length,
          values: [...document.querySelectorAll('.parquet-viewer__profile-value')].map(n => n.textContent),
        })`),
      );
      expect(
        !after.panel && after.rows === 0,
        `the previous file's scan landed on the new file: ${JSON.stringify(after)}`,
      );
      return "a scan reply from the previous file is dropped, the panel stays closed";
    },
  },
  {
    name: "parquet-document-switch-stale-profile",
    async run({ page, base }) {
      await openParquet(page, base, "?mixed=1&profile=1");
      const profiled = await page.waitFor(
        `document.querySelectorAll('.parquet-viewer__list-null').length === 4`,
      );
      expect(profiled, "the profile badges never rendered");
      // From here the host's profile answers are queued, so the only profile reply the webview can
      // see while the second document opens is the one this scenario injects.
      await page.evaluate(`window.__bridge.hold('parquetProfileData')`);
      // `?delay=` keeps the second document "opening" long enough to land a reply in the gap
      // between the switch and the new profile request.
      await page.evaluate(
        `window.__bridge.deliver('open', { path: '/mixed.parquet?delay=1500', fileName: 'second.parquet', documentCacheId: 'demo-second' })`,
      );
      const loading = await page.waitFor(`!!document.querySelector('.parquet-viewer__overlay')`);
      expect(loading, "the second document never showed its loading state");
      const firstRequest = await page.evaluate(
        `window.__bridge.sentOf('parquetProfile')[0].requestId`,
      );
      await page.evaluate(`window.dispatchEvent(new MessageEvent('message', { data: { type: 'parquetProfileData', content: {
        requestId: ${firstRequest},
        profile: {
          rowCount: 3000, rowGroupCount: 2, hasAnyStatistics: true,
          columns: [
            { name: 'id', type: 'INT32', state: 'available', groupsWithStatistics: 2, nullCount: 0, nullRatio: 0 },
            { name: 'name', type: 'STRING', state: 'available', groupsWithStatistics: 2, nullCount: 2310, nullRatio: 0.77 },
          ],
        },
      } } }))`);

      const opened = await page.waitFor(
        `!!document.querySelector('.parquet-table .ant-table-row') && !document.querySelector('.parquet-viewer__overlay')`,
        10000,
      );
      expect(opened, "the second document never rendered");
      const asked = await page.waitFor(`window.__bridge.sentCount('parquetProfile') === 2`);
      expect(asked, "the second document did not ask for its own profile");
      await new Promise((resolve) => setTimeout(resolve, 250));
      const stale = await page.evaluate(
        `[...document.querySelectorAll('.parquet-viewer__list-null')].map(n => n.textContent)`,
      );
      expect(
        stale.length === 0,
        `the previous file's profile landed on the new file: ${JSON.stringify(stale)}`,
      );

      // The new file's own answer is still accepted.
      await page.evaluate(`window.__bridge.release('parquetProfileData')`);
      const fresh = await page.waitFor(
        `document.querySelectorAll('.parquet-viewer__list-null').length === 4`,
      );
      expect(fresh, "the new file's own profile never rendered");
      const name = await page.evaluate(
        `document.querySelectorAll('.parquet-viewer__list-null')[1].textContent`,
      );
      expect(name === "null 12%", `the new file's badge is ${name}`);
      return "a profile reply for the previous file is dropped mid-open, the new one is accepted";
    },
  },
];
