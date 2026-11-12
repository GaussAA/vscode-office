import { expect, json } from "../helpers.mjs";

/**
 * The comparison panel (ADR-0021). The fake host answers with a canned diff, so these scenarios
 * assert what the reader sees for each finding — not how the diff was computed (that is #59's
 * unit tests).
 */
async function openCompare(page, base, mode) {
  await page.navigate(`${base}/harness-route?route=compare&case=${mode}`);
  const ready = await page.waitFor(`!!document.querySelector('.compare-view')`);
  expect(ready, "the compare view did not mount");
}

/** Group titles, in the order they render. */
const groups = (page) =>
  page.evaluate(
    `JSON.stringify([...document.querySelectorAll('.compare-group-title')].map(n => n.textContent.replace(/\\d+$/, '').trim()))`,
  );

export default [
  {
    name: "compare-same-schema",
    async run({ page, base }) {
      await openCompare(page, base, "same");
      const state = json(
        await page.evaluate(`JSON.stringify({
                title: document.querySelector('.compare-title')?.innerText ?? null,
                groups: [...document.querySelectorAll('.compare-group-title')].map(n => n.textContent.trim()),
                rows: document.querySelectorAll('.compare-row').length,
                delta: document.querySelector('.compare-delta')?.textContent ?? null,
                toggle: !!document.querySelector('.compare-toggle input'),
            })`),
      );
      // Same schema is one group, and the row-count line stays quiet when nothing moved.
      expect(state.groups.length === 1, `groups are ${JSON.stringify(state.groups)}`);
      expect(state.groups[0].startsWith("same"), `group is ${state.groups[0]}`);
      expect(state.rows === 2, `rendered ${state.rows} rows`);
      expect(state.delta === null, `a zero row delta still rendered ${state.delta}`);
      expect(state.toggle, "the only-changed toggle is missing");
      expect(
        state.title.includes("orders-2026-11-11.parquet") &&
          state.title.includes("orders-2026-11-12.parquet"),
        `title is ${state.title}`,
      );
      return "same schema: one group, no delta, toggle present";
    },
  },
  {
    name: "compare-added-removed",
    docs: "parquet-compare.png",
    async run({ page, base }) {
      await openCompare(page, base, "added-removed");
      const state = json(
        await page.evaluate(`JSON.stringify({
                groups: [...document.querySelectorAll('.compare-group-title')].map(n => n.textContent.replace(/\\d+$/, '').trim()),
                rows: [...document.querySelectorAll('.compare-row')].map(row => ({
                    name: row.querySelector('.compare-name')?.textContent ?? null,
                    state: row.getAttribute('data-state'),
                    type: row.querySelector('.compare-type')?.textContent ?? null,
                })),
            })`),
      );
      // Findings first: added and removed come before same.
      expect(
        JSON.stringify(state.groups) === JSON.stringify(["added", "removed", "same"]),
        `groups are ${JSON.stringify(state.groups)}`,
      );
      expect(state.rows[0].name === "coupon", `first row is ${state.rows[0].name}`);
      expect(state.rows[0].state === "added", `coupon is ${state.rows[0].state}`);
      expect(state.rows[1].name === "legacy_note", `second row is ${state.rows[1].name}`);
      expect(state.rows[1].state === "removed", `legacy_note is ${state.rows[1].state}`);
      return "columns only one side has are grouped before unchanged ones";
    },
  },
  {
    name: "compare-type-changed",
    async run({ page, base }) {
      await openCompare(page, base, "type");
      const state = json(
        await page.evaluate(`JSON.stringify({
                type: [...document.querySelectorAll('.compare-row')]
                    .find(row => row.getAttribute('data-state') === 'type-changed')
                    ?.querySelector('.compare-type')?.textContent ?? null,
                nil: [...document.querySelectorAll('.compare-row')]
                    .find(row => row.getAttribute('data-state') === 'type-changed')
                    ?.querySelector('.compare-null')?.textContent ?? null,
            })`),
      );
      expect(state.type === "INT32 → DOUBLE", `type cell is ${state.type}`);
      // A type change still carries the null-share move; only the range is meaningless.
      expect(state.nil.includes("1%") && state.nil.includes("2%"), `null cell is ${state.nil}`);
      expect(state.nil.includes("+1.0%"), `null delta is ${state.nil}`);
      return `type cell "${state.type}", null cell "${state.nil}"`;
    },
  },
  {
    name: "compare-unreadable-side",
    async run({ page, base }) {
      await openCompare(page, base, "unreadable");
      const ready = await page.waitFor(`!!document.querySelector('.compare-error')`);
      expect(ready, "an unreadable side rendered no error");
      const text = json(
        await page.evaluate(`JSON.stringify(document.querySelector('.compare-error').textContent)`),
      );
      // The message has to name the side and the reason; "comparison failed" would not.
      expect(text.includes("right"), `error does not name the side: ${text}`);
      expect(text.includes("PAR1"), `error does not carry the reason: ${text}`);
      return "a bad side names itself and its reason";
    },
  },
  {
    name: "compare-row-count-moved",
    async run({ page, base }) {
      await openCompare(page, base, "rows");
      const state = json(
        await page.evaluate(`JSON.stringify({
                delta: document.querySelector('.compare-delta')?.textContent ?? null,
                counts: document.querySelector('.compare-counts')?.textContent ?? null,
                errors: document.querySelectorAll('.compare-error').length,
            })`),
      );
      // A row-count move is a finding in the header, not an error state on the panel.
      expect(state.errors === 0, "a row-count difference rendered as an error");
      expect(state.delta && state.delta.includes("5,000"), `delta is ${state.delta}`);
      expect(state.counts.includes("1,000,000"), `counts are ${state.counts}`);
      return `row delta reads "${state.delta}"`;
    },
  },
  {
    name: "compare-only-changed-toggle",
    async run({ page, base }) {
      await openCompare(page, base, "same");
      await page.evaluate(`document.querySelector('.compare-toggle input').click()`);
      const hidden = await page.waitFor(`document.querySelectorAll('.compare-group').length === 0`);
      expect(hidden, "the only-changed toggle left the unchanged group on screen");
      await page.evaluate(`document.querySelector('.compare-toggle input').click()`);
      const back = await page.waitFor(`document.querySelectorAll('.compare-group').length === 1`);
      expect(back, "switching the toggle back did not restore the group");
      return "only-changed hides the same group and restores it";
    },
  },
];
