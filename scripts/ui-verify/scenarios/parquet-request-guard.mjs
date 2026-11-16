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
];
