import { expect, json, openParquet } from "../helpers.mjs";

/**
 * Keyboard reachability (ADR-0023 decision 3).
 *
 * Nothing so far answered "can a keyboard user actually get around?". This walks the real Tab
 * order with real key presses — a dispatched `KeyboardEvent` leaves focus where it was and would
 * pass while a user is stuck — then exercises the grid's own entry rule.
 *
 * The grid does **not** put cells in the tab order: it is a `role="grid"` with a roving tabindex,
 * so Tab lands on the grid and the arrow keys move into a cell. The first run of this scenario
 * asserted "Tab reaches a cell" and failed — that was the assertion being wrong about the design,
 * not the design being wrong. Both halves are checked now, because the combination is what the
 * pattern promises.
 */
const MAX_TABS = 60;

/** Which part of the viewer holds focus, in the vocabulary the reader thinks in. */
const ACTIVE = `JSON.stringify((() => {
    const node = document.activeElement;
    if (!node || node === document.body) return { region: 'body', tag: 'BODY' };
    const region = (() => {
        if (node.closest('.parquet-viewer__topbar')) return 'topbar';
        if (node.closest('.parquet-viewer__sider')) return 'sider';
        if (node.closest('.parquet-viewer__bottombar')) return 'bottombar';
        if (node.closest('.parquet-viewer__profile')) return 'profile-panel';
        if (node.closest('.parquet-viewer__inspector')) return 'value-panel';
        if (node.closest('.ant-table-thead')) return 'header';
        if (node.closest('.ant-table-tbody-virtual')) return 'cell';
        if (node.closest('[role="grid"]')) return 'grid';
        return 'other';
    })();
    return {
        region,
        tag: node.tagName,
        label: node.getAttribute('aria-label') ?? node.getAttribute('title') ?? null,
        cls: String(node.className ?? '').slice(0, 48),
        gridcell: node.getAttribute('role') === 'gridcell' || node.hasAttribute('aria-colindex'),
    };
})())`;

export default [
  {
    name: "parquet-tab-order",
    async run({ page, base }) {
      await openParquet(page, base, "?preview=1");
      // Start from a known place: whatever the page focused on mount.
      await page.evaluate(`document.activeElement?.blur?.(); document.body.focus?.();`);

      const stops = [];
      for (let index = 0; index < MAX_TABS; index += 1) {
        await page.press("Tab");
        const stop = json(await page.evaluate(ACTIVE));
        stops.push({ index: index + 1, ...stop });
      }

      const report = stops
        .map(
          (stop) =>
            `${stop.index}:${stop.region}(${stop.tag}${stop.label ? ` "${stop.label}"` : ""})`,
        )
        .join(" ");

      // 1. Every interactive region must be reachable from the keyboard. A missing region is the
      //    bug this scenario exists for; the order itself is not asserted, so adding a control
      //    cannot fail the suite.
      const reached = new Set(stops.map((stop) => stop.region));
      const required = ["topbar", "sider", "header", "grid", "bottombar"];
      const missing = required.filter((region) => !reached.has(region));
      expect(
        missing.length === 0,
        `Tab never reached ${missing.join(", ")} in ${MAX_TABS} presses. Order: ${report}`,
      );

      // 2. No dead loop: the same element for three presses in a row means focus is stuck.
      for (let index = 2; index < stops.length; index += 1) {
        const [a, b, c] = [stops[index - 2], stops[index - 1], stops[index]];
        // Identity includes the label: twelve column resizers share tag and class, and only the
        // label says they are twelve different stops rather than one frozen element.
        const key = (stop) => `${stop.tag}|${stop.cls}|${stop.label ?? ""}`;
        const same = key(a) === key(b) && key(b) === key(c);
        expect(
          !same,
          `focus stalled on <${c.tag} class="${c.cls}"> at presses ${a.index}–${c.index}; order: ${report}`,
        );
      }

      // 3. The cycle may wrap to the browser chrome — that is where Tab goes after the last stop,
      //    and asserting "never body" would forbid a wrap that has to happen. What matters is that
      //    it only wraps after the reader has been offered every region.
      const firstWrap = stops.findIndex((stop) => stop.region === "body");
      if (firstWrap >= 0) {
        const beforeWrap = new Set(stops.slice(0, firstWrap).map((stop) => stop.region));
        const unseen = required.filter((region) => !beforeWrap.has(region));
        expect(
          unseen.length === 0,
          `Tab wrapped to the browser before reaching ${unseen.join(", ")}; order: ${report}`,
        );
      }

      // 4. The other half of a roving grid: from the grid, an arrow key must put focus on a cell,
      //    and Tab must then leave the grid rather than trap the reader inside it.
      const gridStop = stops.find((stop) => stop.region === "grid");
      await page.evaluate(`document.activeElement?.blur?.(); document.body.focus?.();`);
      for (let index = 0; index < MAX_TABS; index += 1) {
        await page.press("Tab");
        if (json(await page.evaluate(ACTIVE)).region === "grid") break;
      }
      const onGrid = json(await page.evaluate(ACTIVE));
      expect(onGrid.region === "grid", `could not tab onto the grid (landed on ${onGrid.region})`);

      await page.press("ArrowDown");
      const onCell = json(await page.evaluate(ACTIVE));
      // The focused node is the cell or its value span; what matters is that it is inside the
      // body grid, i.e. the arrow key moved into the data rather than staying on the wrapper.
      expect(
        onCell.region === "cell",
        `an arrow key on the grid did not focus a cell (landed on ${onCell.region}/${onCell.tag})`,
      );

      await page.press("Tab");
      const afterCell = json(await page.evaluate(ACTIVE));
      expect(
        afterCell.region !== "cell",
        "Tab from a cell stayed in the grid: the roving tabindex is trapping focus",
      );

      const counts = required.map(
        (region) => `${region}×${stops.filter((s) => s.region === region).length}`,
      );
      return `Tab reaches ${counts.join(" ")}; arrow enters a cell (${onCell.label ?? onCell.cls}), Tab leaves to ${afterCell.region}${gridStop ? "" : " (grid only via wrap)"}`;
    },
  },
];
