import { expect, json, openParquet } from "../helpers.mjs";

/**
 * Motion (ADR-0022) is state feedback only, 120–180 ms, and it must be *removable*: a user who
 * asks the system for reduced motion gets the same screens without the travel.
 *
 * These scenarios assert the contract, not the look: durations inside a window, zero durations
 * under the preference, and no layout change when a docked panel opens or closes.
 */

async function openProfilePanel(page, base) {
  await openParquet(page, base, "?profile=1");
  await page.evaluate(`(() => {
        const row = document.querySelector('.parquet-viewer__list-item');
        row?.focus();
        row?.dispatchEvent(new KeyboardEvent('keydown', { key: 'i', bubbles: true }));
    })()`);
  const opened = await page.waitFor(`!!document.querySelector('.parquet-viewer__profile')`);
  if (!opened) throw new Error("the docked panel never opened");
}

const DURATION_SECONDS = (value) => {
  const text = String(value ?? "").trim();
  return text.endsWith("ms") ? Number.parseFloat(text) / 1000 : Number.parseFloat(text);
};

export default [
  {
    name: "parquet-motion-budget",
    async run({ page, base }) {
      await openProfilePanel(page, base);
      const state = json(
        await page.evaluate(`JSON.stringify((() => {
                const panel = document.querySelector('.parquet-viewer__profile');
                const row = document.querySelector('.parquet-viewer__list-item');
                const button = document.querySelector('.parquet-viewer__pager-btn');
                const read = (node) => {
                    if (!node) return null;
                    const style = getComputedStyle(node);
                    return {
                        animation: style.animationName + ' ' + style.animationDuration,
                        transition: style.transitionDuration,
                    };
                };
                return { panel: read(panel), row: read(row), button: read(button) };
            })())`),
      );

      // The docked panel has an entrance, and it is a state change of 120–180 ms, no more.
      const animation = (state.panel?.animation ?? "").split(" ");
      expect(
        state.panel?.animation.startsWith("pv-panel-in"),
        `panel animation is ${state.panel?.animation}`,
      );
      const seconds = DURATION_SECONDS(animation.at(-1));
      expect(
        seconds > 0.1 && seconds <= 0.2,
        `panel entrance is ${animation.at(-1)} — outside the 120–180 ms window`,
      );

      // Hover/selection feedback: every declared transition duration stays inside the window.
      for (const [name, node] of [
        ["row", state.row],
        ["button", state.button],
      ]) {
        const durations = String(node?.transition ?? "")
          .split(",")
          .map((value) => DURATION_SECONDS(value))
          .filter((value) => Number.isFinite(value));
        if (durations.length === 0) continue;
        for (const duration of durations) {
          expect(duration <= 0.2, `${name} transition is ${duration}s — too slow for feedback`);
        }
      }

      return `panel ${animation.at(-1)}, feedback ≤ 0.2s`;
    },
  },
  {
    name: "parquet-motion-reduced",
    async run({ page, base, setReducedMotion }) {
      // Set before navigating: both the CSS tokens and antd's `motion` token read it at startup.
      await setReducedMotion(true);
      await openProfilePanel(page, base);
      const state = json(
        await page.evaluate(`JSON.stringify((() => {
                const panel = document.querySelector('.parquet-viewer__profile');
                const button = document.querySelector('.parquet-viewer__pager-btn');
                const style = panel ? getComputedStyle(panel) : null;
                const roots = getComputedStyle(document.documentElement);
                return {
                    panelVisible: !!panel && panel.getBoundingClientRect().height > 0,
                    animation: style ? style.animationDuration : null,
                    fast: roots.getPropertyValue('--motion-fast').trim(),
                    base: roots.getPropertyValue('--motion-base').trim(),
                    buttonTransition: button ? getComputedStyle(button).transitionDuration : null,
                };
            })())`),
      );

      // Zeroed, not removed: the panel is still there, still in its final place.
      expect(
        state.panelVisible,
        "the panel is missing under reduced motion — the end state was lost",
      );
      expect(state.fast === "0s" && state.base === "0s", `tokens are ${state.fast}/${state.base}`);
      const animationSeconds = (state.animation ?? "")
        .split(",")
        .map((value) => DURATION_SECONDS(value))
        .filter((value) => Number.isFinite(value));
      expect(
        animationSeconds.every((value) => value === 0),
        `panel still animates: ${state.animation}`,
      );
      const buttonSeconds = (state.buttonTransition ?? "")
        .split(",")
        .map((value) => DURATION_SECONDS(value))
        .filter((value) => Number.isFinite(value));
      expect(
        buttonSeconds.every((value) => value === 0),
        `controls still transition: ${state.buttonTransition}`,
      );
      return `zeroed under reduced motion, panel still in place (${state.animation})`;
    },
  },
  {
    name: "parquet-motion-no-reflow",
    async run({ page, base }) {
      await openProfilePanel(page, base);
      const before = json(
        await page.evaluate(`JSON.stringify({
                rows: document.querySelectorAll('.ant-table-tbody-virtual .ant-table-row').length,
                firstColumnWidth: document.querySelector('.ant-table-header th')?.getBoundingClientRect().width ?? null,
                tableTop: document.querySelector('.parquet-viewer__main')?.getBoundingClientRect().top ?? null,
            })`),
      );
      await page.evaluate(
        `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`,
      );
      const closed = await page.waitFor(`!document.querySelector('.parquet-viewer__profile')`);
      expect(closed, "Escape did not close the panel");
      await page.evaluate(`(() => {
            const row = document.querySelector('.parquet-viewer__list-item');
            row?.focus();
            row?.dispatchEvent(new KeyboardEvent('keydown', { key: 'i', bubbles: true }));
        })()`);
      const reopened = await page.waitFor(`!!document.querySelector('.parquet-viewer__profile')`);
      expect(reopened, "the panel did not reopen");
      const after = json(
        await page.evaluate(`JSON.stringify({
                rows: document.querySelectorAll('.ant-table-tbody-virtual .ant-table-row').length,
                firstColumnWidth: document.querySelector('.ant-table-header th')?.getBoundingClientRect().width ?? null,
                tableTop: document.querySelector('.parquet-viewer__main')?.getBoundingClientRect().top ?? null,
            })`),
      );

      // The panel covers the table; it must not resize it. A moving table is the difference
      // between "a panel opened" and "the page jumped".
      expect(before.rows === after.rows, `row count changed ${before.rows} → ${after.rows}`);
      expect(
        before.firstColumnWidth === after.firstColumnWidth,
        `column width changed ${before.firstColumnWidth} → ${after.firstColumnWidth}`,
      );
      expect(
        before.tableTop === after.tableTop,
        `table moved ${before.tableTop} → ${after.tableTop}`,
      );
      return `open/close changed nothing: ${after.rows} rows, column ${after.firstColumnWidth}px`;
    },
  },
];
