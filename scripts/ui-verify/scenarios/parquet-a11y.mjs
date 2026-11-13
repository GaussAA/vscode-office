import { expect, json, openParquet } from "../helpers.mjs";

/**
 * Audible feedback (ADR-0023). A screen reader user cannot see the pager label change or a match
 * count appear, so those two answers have to be spoken. Selection already has its own region in
 * the inspector; this one carries navigation and search, latest event wins.
 */

const announceText = `document.querySelector('.parquet-viewer__announce')?.textContent ?? ''`;

async function announcement(page) {
  return json(await page.evaluate(`JSON.stringify(${announceText})`));
}

export default [
  {
    name: "parquet-announce-pagination",
    async run({ page, base }) {
      await openParquet(page, base);
      const live = json(
        await page.evaluate(`JSON.stringify((() => {
                const node = document.querySelector('.parquet-viewer__announce');
                return node
                    ? { role: node.getAttribute('role'), live: node.getAttribute('aria-live') }
                    : null;
            })())`),
      );
      expect(live !== null, "there is no announcement region at all");
      expect(live.role === "status" && live.live === "polite", `region is ${JSON.stringify(live)}`);

      // The first page announces itself, so a reader arriving at the file knows where it is.
      const first = await page.waitFor(`(${announceText}).includes('of')`);
      expect(first, "the first page was never announced");
      const before = await announcement(page);

      await page.evaluate(`[...document.querySelectorAll('.parquet-viewer__pager-btn')]
            .filter(b => b.getAttribute('aria-label') === 'Next page')[0]
            ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
      const changed = await page.waitFor(`(${announceText}) !== ${JSON.stringify(before)}`);
      expect(changed, `the page turn was not announced (still "${before}")`);
      const after = await announcement(page);
      // Both spellings come from one helper, so they cannot drift apart.
      expect(after.includes("of"), `announcement is ${after}`);
      expect(after !== before, `announcement did not move: ${after}`);
      return `"${before}" → "${after}"`;
    },
  },
  {
    name: "parquet-announce-search",
    async run({ page, base }) {
      // The mixed fixture has string values (`service-a-0`); the default one is two numeric
      // columns, so a text query there could only ever announce "0 matches".
      await openParquet(page, base, "?mixed=1");
      await page.waitFor(`(${announceText}).includes('of')`);
      const before = await announcement(page);

      await page.evaluate(`(() => {
            const input = document.querySelector('.parquet-viewer__search input');
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            input.focus();
            setter.call(input, 'service-');
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        })()`);

      const announced = await page.waitFor(`/[1-9]\\d* match/.test(${announceText})`);
      const text = await announcement(page);
      expect(announced, `a finished search was not announced (region still "${text}")`);
      expect(text !== before, "the search announcement did not replace the page one");
      // A count, not progress: "17 matches so far" would queue a message per scanned batch.
      // A real hit, not "0 matches": a count that never leaves zero would pass a looser check.\n      expect(/^[1-9]\\d* match/.test(text), `announcement is ${text}`);
      return `search announced as "${text}"`;
    },
  },
];
