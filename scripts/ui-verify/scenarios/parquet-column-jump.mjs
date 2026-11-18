import { expect, json, openParquet } from "../helpers.mjs";

/**
 * Column jump animation: clicking a field in the schema list should smoothly scroll the table
 * to bring that column into view, without jank or layout thrashing.
 *
 * This scenario measures the behavior to detect animation smoothness issues.
 */

/**
 * Click one field in the schema list and sample the grid's horizontal position every frame.
 *
 * The glide lives in layout offsets that only exist between two paints, so the samples are the
 * evidence: where the body went, where the header went, and when each change happened.
 */
async function sampleSchemaJump(page, field, settleMs = 600) {
  const jump = json(
    await page.evaluate(`(async () => {
        const wrap = document.querySelector('.parquet-viewer__table-wrap');
        const list = wrap?.querySelector('.ant-table-tbody-virtual');
        const inner = wrap?.querySelector('.ant-table-tbody-virtual-holder-inner');
        const header = wrap?.querySelector('.ant-table-header');
        const item = [...document.querySelectorAll('.parquet-viewer__list-item')]
            .find(button => button.querySelector('.parquet-viewer__list-name')?.textContent === ${JSON.stringify(field)});
        const headCell = header && [...header.querySelectorAll('th[aria-colindex]')]
            .find(th => th.textContent === ${JSON.stringify(field)});
        if (!wrap || !list || !inner || !header || !item || !headCell) {
            return JSON.stringify({ error: 'the grid or the field is missing' });
        }
        const offset = () => wrap.getBoundingClientRect().left - inner.getBoundingClientRect().left;
        const samples = [];
        const t0 = performance.now();
        item.click();
        await new Promise((resolve) => {
            const step = () => {
                const cell = headCell.getBoundingClientRect();
                samples.push({
                    t: performance.now() - t0,
                    x: offset(),
                    header: header.scrollLeft,
                    left: cell.left,
                    width: cell.width,
                    centre: cell.left + cell.width / 2,
                });
                if (performance.now() - t0 < ${settleMs}) requestAnimationFrame(step);
                else resolve();
            };
            requestAnimationFrame(step);
        });
        const listRect = list.getBoundingClientRect();
        return JSON.stringify({
            samples,
            viewportCentre: listRect.left + listRect.width / 2,
            viewportLeft: listRect.left,
            viewportRight: listRect.right,
            maxScroll: inner.scrollWidth - list.clientWidth,
        });
    })()`),
  );
  return jump;
}

/** How the offset moved: a glide has several steps, one direction and no overshoot. */
function glideShape(samples) {
  const from = samples[0].x;
  const to = samples[samples.length - 1].x;
  const direction = Math.sign(to - from);
  let moves = 0;
  let movedAt = 0;
  let lastMoveAt = 0;
  let reversals = 0;
  let overshoot = 0;
  let lastSign = 0;
  for (let index = 1; index < samples.length; index++) {
    const delta = samples[index].x - samples[index - 1].x;
    if (Math.abs(delta) > 0.5) {
      moves += 1;
      movedAt = movedAt || samples[index].t;
      lastMoveAt = samples[index].t;
      const sign = Math.sign(delta);
      if (lastSign !== 0 && sign !== lastSign) reversals += 1;
      lastSign = sign;
    }
    if (direction !== 0) overshoot = Math.max(overshoot, (samples[index].x - to) * direction);
  }
  return { from, to, direction, moves, movedAt, lastMoveAt, reversals, overshoot };
}

export default [
  {
    name: "parquet-column-jump-animation",
    async run({ page, base, setReducedMotion }) {
      // The emulation sticks to the page, so an earlier reduced-motion scenario would turn this into a single jump.
      await setReducedMotion(false);
      // Open a parquet file with enough columns to require horizontal scrolling (12 columns)
      await openParquet(page, base, "?preview=1");

      // Wait for the table to be fully rendered AND scrollable horizontally
      const tableReady = await page.waitFor(
        `document.querySelectorAll('.ant-table-tbody-virtual .ant-table-row').length > 0`,
      );
      expect(tableReady, "table did not render");

      // Wait for the table to overflow horizontally (critical for jump to work)
      const scrollable = await page.waitFor(
        `(() => {
          const wrap = document.querySelector('.parquet-viewer__table-wrap');
          const inner = wrap?.querySelector('.ant-table-tbody-virtual-holder-inner');
          return !!wrap && !!inner && inner.scrollWidth > wrap.clientWidth + 1;
        })()`,
        6000,
      );
      expect(scrollable, "table never overflowed horizontally");

      const columnCount = json(
        await page.evaluate(`document.querySelectorAll('.parquet-viewer__list-item').length`),
      );
      expect(columnCount >= 3, `need at least 3 columns, got ${columnCount}`);

      // Per-frame sampler. rc-virtual-list moves the body by transform, so `scrollLeft` stays 0;
      // the real offset is how far the inner holder sits left of the wrapper. Header is its own
      // scroll surface and is sampled separately to catch header/body desync (visible as shake).
      await page.evaluate(`(() => {
        window.__jump = { samples: [], stop: false, scrollTo: 0 };
        const orig = Element.prototype.scrollTo;
        Element.prototype.scrollTo = function (...a) { window.__jump.scrollTo++; return orig.apply(this, a); };
        const t0 = performance.now();
        const tick = () => {
          const wrap = document.querySelector('.parquet-viewer__table-wrap');
          const inner = wrap?.querySelector('.ant-table-tbody-virtual-holder-inner');
          const header = wrap?.querySelector('.ant-table-header');
          if (wrap && inner) {
            window.__jump.samples.push({
              t: Math.round(performance.now() - t0),
              body: Math.round((wrap.getBoundingClientRect().left - inner.getBoundingClientRect().left) * 10) / 10,
              header: header ? Math.round(header.scrollLeft * 10) / 10 : null,
            });
          }
          if (!window.__jump.stop) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      })()`);

      const jump = json(
        await page.evaluate(`(() => {
          const items = document.querySelectorAll('.parquet-viewer__list-item');
          const target = items[items.length - 1];
          target?.click();
          return JSON.stringify({ found: !!target });
        })()`),
      );
      expect(jump.found, "last column not found in schema sidebar");

      const arrived = await page.waitFor(
        `(() => {
          const activeCell = document.querySelector('.ant-table-tbody-virtual .ant-table-cell.parquet-viewer__column--active');
          const wrap = document.querySelector('.parquet-viewer__table-wrap');
          if (!activeCell || !wrap) return false;
          const w = wrap.getBoundingClientRect();
          const c = activeCell.getBoundingClientRect();
          return c.width > 0 && c.left >= w.left && c.right <= w.right + 1;
        })()`,
        6000,
      );
      expect(arrived, "column did not arrive in viewport within timeout");
      // Let any late retry attempt play out so overshoot/rebound is captured.
      await page.evaluate(`new Promise((r) => setTimeout(r, 1500))`);

      const m = json(
        await page.evaluate(`(() => {
          window.__jump.stop = true;
          const s = window.__jump.samples;
          const moves = [];
          for (let i = 1; i < s.length; i++) {
            const d = s[i].body - s[i - 1].body;
            if (Math.abs(d) >= 0.5) moves.push({ i, t: s[i].t, d: Math.round(d * 10) / 10 });
          }
          let reversals = 0;
          for (let i = 1; i < moves.length; i++) if (Math.sign(moves[i].d) !== Math.sign(moves[i - 1].d)) reversals++;
          const desync = s.filter((x) => x.header !== null && Math.abs(x.header - x.body) > 2).length;
          const final = s[s.length - 1];
          return JSON.stringify({
            start: s[0]?.body ?? 0, end: final?.body ?? 0,
            frames: s.length, moveFrames: moves.length, reversals, desync,
            maxStep: moves.reduce((a, x) => Math.max(a, Math.abs(x.d)), 0),
            span: moves.length ? moves[moves.length - 1].t - moves[0].t : 0,
            scrollTo: window.__jump.scrollTo,
            moves: moves.slice(0, 30),
          });
        })()`),
      );

      // Hard assertions: the jump must land, keep header in step, and never rebound.
      expect(m.end > m.start + 1, `body did not move: ${m.start} → ${m.end}`);
      expect(
        m.reversals === 0,
        `scroll rebounded ${m.reversals}x (shake); moves=${JSON.stringify(m.moves)}`,
      );
      expect(m.desync === 0, `header out of step with body on ${m.desync} frames`);

      // Smoothness: a one-frame jump of the whole distance is not an animation. `span` carries
      // the same fact independently of how many frames the machine manages to paint.
      const dist = Math.abs(m.end - m.start);
      const steps = m.moveFrames;
      const summary = `${m.start} → ${m.end} (${Math.round(dist)}px) in ${m.span}ms, ${steps} moving frames, maxStep ${m.maxStep}px, reversals ${m.reversals}, desync ${m.desync}, scrollTo ${m.scrollTo}`;
      console.log("[parquet-column-jump] " + summary + " moves=" + JSON.stringify(m.moves));
      expect(steps >= 4 && m.span >= 80, `not animated: only ${steps} moving frames. ${summary}`);
      expect(
        m.maxStep <= dist * 0.6,
        `one frame covers ${Math.round((m.maxStep / dist) * 100)}% of the distance. ${summary}`,
      );
      return summary;
    },
  },

  {
    name: "parquet-column-jump-reduced-motion",
    async run({ page, base, setReducedMotion }) {
      // ADR-0022 promises the travel is zeroed under reduced motion, but the destination is not.
      await setReducedMotion(true);
      try {
        await openParquet(page, base, "?wide=1");
        await page.sleep(250);
        const jump = await sampleSchemaJump(page, "field_24");
        expect(!jump.error, jump.error ?? "");
        const shape = glideShape(jump.samples);
        const last = jump.samples[jump.samples.length - 1];
        expect(
          shape.moves <= 1,
          `reduced motion still animated the jump over ${shape.moves} frames`,
        );
        expect(
          Math.abs(last.header - last.x) <= 2,
          `the header trailed by ${Math.abs(last.header - last.x)}px under reduced motion`,
        );
        const offCentre = Math.abs(last.centre - jump.viewportCentre);
        expect(offCentre <= 2, `reduced-motion jump landed ${offCentre}px off centre`);
        return `reduced motion: ${shape.moves} moving frame(s), centred within ${offCentre}px`;
      } finally {
        await setReducedMotion(false);
      }
    },
  },

  {
    name: "parquet-column-jump-toggles-the-highlight",
    async run({ page, base, setReducedMotion }) {
      await setReducedMotion(false);
      await openParquet(page, base, "?wide=1");
      await page.sleep(250);
      const clickField = async (field) => {
        const found = await page.evaluate(`(() => {
          const item = [...document.querySelectorAll('.parquet-viewer__list-item')]
              .find(button => button.querySelector('.parquet-viewer__list-name')?.textContent === ${JSON.stringify(field)});
          item?.click();
          return !!item;
        })()`);
        expect(found, `the ${field} field is missing from the schema sidebar`);
        // Long enough for the 180 ms glide to settle before the next click.
        await page.sleep(350);
      };
      const readState = () =>
        page
          .evaluate(`JSON.stringify((() => {
            const list = document.querySelector('.parquet-viewer__list-item--active');
            const header = document.querySelector('.parquet-table th.parquet-viewer__column--active');
            const cells = document.querySelectorAll(
                '.ant-table-tbody-virtual .ant-table-cell.parquet-viewer__column--active');
            const activeCell = cells[0];
            const row = activeCell?.parentElement;
            const plainCell = row && [...row.querySelectorAll('.ant-table-cell:not(.parquet-viewer__column--active)')][1];
            const rgb = (element) => {
                if (!element) return null;
                const value = getComputedStyle(element).backgroundColor;
                // Chrome resolves color-mix() to CSS Color 4 color(srgb 0..1 ...);
                // plain backgrounds stay rgb(0..255, ...). Compare them in 0..255.
                const modern = value.match(/color\\(srgb\\s+([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)/);
                if (modern) {
                    return [1, 2, 3].map((index) => Math.round(Number(modern[index]) * 255));
                }
                const match = value.match(/\\d+/g);
                return match ? match.slice(0, 3).map(Number) : null;
            };
            const wrap = document.querySelector('.parquet-viewer__table-wrap');
            const inner = wrap?.querySelector('.ant-table-tbody-virtual-holder-inner');
            const cellColors = [...cells]
                .map((cell) => {
                    const color = rgb(cell);
                    return color ? color.join(',') : null;
                })
                .filter((value) => value !== null);
            return {
                activeName: list?.querySelector('.parquet-viewer__list-name')?.textContent ?? null,
                headerCount: header ? 1 : 0,
                headerName: header?.textContent ?? null,
                cellCount: cells.length,
                activeBg: rgb(activeCell),
                activeRaw: activeCell ? getComputedStyle(activeCell).backgroundColor : null,
                plainBg: rgb(plainCell),
                plainRaw: plainCell ? getComputedStyle(plainCell).backgroundColor : null,
                uniqueCellBgs: [...new Set(cellColors)],
                offset: wrap && inner
                    ? wrap.getBoundingClientRect().left - inner.getBoundingClientRect().left
                    : null,
            };
        })())`)
          .then(json);

      await clickField("field_12");
      const selected = await readState();
      expect(
        selected.activeName === "field_12",
        `the clicked field is not active: ${selected.activeName}`,
      );
      expect(selected.headerCount === 1, "the active column header is not tinted");
      expect(selected.headerName === "field_12", `wrong header tinted: ${selected.headerName}`);
      expect(selected.cellCount > 0, "the active column cells are not tinted");
      // Zebra rows must not cut the column into stripes: every active cell, on an alt row or
      // not, has to resolve to the same background.
      expect(
        selected.uniqueCellBgs.length === 1,
        `the active column is striped: ${JSON.stringify(selected.uniqueCellBgs)}`,
      );
      // The tint has to read as a column, not as a rounding error: compare it against a plain
      // cell of the same row. Signal Blue is the documented hue source (DESIGN.md), so the
      // blue channel carries the lift; 7% (the old value) sits below this threshold.
      expect(
        selected.activeBg && selected.plainBg,
        `cannot read the active/plain cell backgrounds: ${JSON.stringify(selected)}`,
      );
      const blueLift = selected.activeBg[2] - selected.plainBg[2];
      expect(blueLift >= 20, `the active column tint is too faint: ${JSON.stringify(selected)}`);

      // A second click on the same field is the dismissal: no tint, and no navigation.
      await clickField("field_12");
      const dismissed = await readState();
      expect(dismissed.activeName === null, `the field stayed active: ${dismissed.activeName}`);
      expect(
        dismissed.headerCount === 0 && dismissed.cellCount === 0,
        `the tint survived the dismissal (${dismissed.headerCount} header, ${dismissed.cellCount} cells)`,
      );
      expect(
        dismissed.offset !== null &&
          selected.offset !== null &&
          Math.abs(dismissed.offset - selected.offset) <= 0.5,
        `dismissing the highlight moved the grid (${selected.offset} → ${dismissed.offset})`,
      );

      // Clicking it again restores the highlight, and clicking another field moves the tint
      // instead of accumulating a second one.
      await clickField("field_12");
      const restored = await readState();
      expect(restored.activeName === "field_12", "the field could not be selected again");
      await clickField("field_30");
      const moved = await readState();
      expect(moved.activeName === "field_30", `the highlight did not move: ${moved.activeName}`);
      expect(moved.headerCount === 1, "more than one header carries the tint");
      expect(moved.headerName === "field_30", `wrong header after moving: ${moved.headerName}`);
      return `toggle on/off/re-on works, ${blueLift} blue lift, tint moved to field_30`;
    },
  },

  {
    name: "parquet-column-jump-clamps-at-the-ends",
    async run({ page, base, setReducedMotion }) {
      await setReducedMotion(false);
      await openParquet(page, base, "?wide=1");
      await page.sleep(250);
      // The last field cannot be centred: the grid stops at its scroll limit, and the column
      // has to sit flush with the right edge — fully visible, header aligned, not clipped.
      const last = await sampleSchemaJump(page, "field_47");
      expect(!last.error, last.error ?? "");
      expect(last.maxScroll > 0, "the wide fixture does not overflow; there is nothing to clamp");
      const lastShape = glideShape(last.samples);
      const lastSample = last.samples[last.samples.length - 1];
      expect(
        Math.abs(lastShape.to - last.maxScroll) <= 1,
        `the last field stopped at ${lastShape.to}, not the ${last.maxScroll}px limit`,
      );
      expect(
        lastShape.reversals === 0 && lastShape.overshoot <= 1,
        `the clamped jump reversed ${lastShape.reversals} time(s) and overshot ${lastShape.overshoot}px`,
      );
      expect(
        lastSample.left >= last.viewportLeft - 1,
        `the last column starts ${Math.round(last.viewportLeft - lastSample.left)}px left of the viewport`,
      );
      expect(
        lastSample.left + lastSample.width <= last.viewportRight + 1,
        `the last column is clipped by ${Math.round(lastSample.left + lastSample.width - last.viewportRight)}px`,
      );
      expect(
        Math.abs(lastSample.header - lastSample.x) <= 2,
        `the header trailed by ${Math.abs(lastSample.header - lastSample.x)}px at the right edge`,
      );
      // The clamp is the point: a centred column would be in the middle of the viewport.
      expect(
        Math.abs(lastSample.centre - last.viewportCentre) > 100,
        "the last field was centred; the scroll limit was not respected",
      );

      // The mirror image: the first data column has empty space to its left, so it is flush
      // with the start of the content and the glide has to travel all the way back.
      const first = await sampleSchemaJump(page, "id");
      const firstShape = glideShape(first.samples);
      const firstSample = first.samples[first.samples.length - 1];
      expect(Math.abs(firstShape.to) <= 1, `the first field stopped at ${firstShape.to}, not 0`);
      expect(
        firstShape.reversals === 0 && firstShape.overshoot <= 1,
        `the return jump reversed ${firstShape.reversals} time(s) and overshot ${firstShape.overshoot}px`,
      );
      expect(
        firstSample.left >= first.viewportLeft - 1 &&
          firstSample.left + firstSample.width <= first.viewportRight + 1,
        "the first column is not fully visible at offset 0",
      );
      expect(
        Math.abs(firstSample.header - firstSample.x) <= 2,
        `the header trailed by ${Math.abs(firstSample.header - firstSample.x)}px at the left edge`,
      );
      expect(
        Math.abs(firstSample.centre - first.viewportCentre) > 100,
        "the first field was centred; there is no content to scroll past 0",
      );
      return `ends clamp to 0 and ${last.maxScroll}px, both columns fully visible and aligned`;
    },
  },

  {
    name: "parquet-column-jump-last-click-wins",
    async run({ page, base, setReducedMotion }) {
      await setReducedMotion(false);
      await openParquet(page, base, "?wide=1");
      const storm = json(
        await page.evaluate(`(async () => {
                const wrap = document.querySelector('.parquet-viewer__table-wrap');
                const list = wrap?.querySelector('.ant-table-tbody-virtual');
                const inner = wrap?.querySelector('.ant-table-tbody-virtual-holder-inner');
                const header = wrap?.querySelector('.ant-table-header');
                if (!wrap || !list || !inner || !header) return JSON.stringify({ error: 'the grid is missing' });
                const pick = (name) => [...document.querySelectorAll('.parquet-viewer__list-item')]
                    .find(button => button.querySelector('.parquet-viewer__list-name')?.textContent === name);
                const names = ['field_40', 'field_3', 'field_47', 'field_12', 'field_8'];
                const items = names.map(pick);
                if (items.some((item) => !item)) return JSON.stringify({ error: 'the fields are missing' });
                const offset = () => wrap.getBoundingClientRect().left - inner.getBoundingClientRect().left;
                const samples = [];
                let running = true;
                const t0 = performance.now();
                const step = () => {
                    samples.push({ t: performance.now() - t0, x: offset() });
                    if (running) requestAnimationFrame(step);
                };
                requestAnimationFrame(step);
                let lastClickedAt = 0;
                for (const item of items) {
                    item.click();
                    lastClickedAt = performance.now() - t0;
                    await new Promise((resolve) => setTimeout(resolve, 20));
                }
                await new Promise((resolve) => setTimeout(resolve, 750));
                running = false;
                const listRect = list.getBoundingClientRect();
                const centreOf = (name) => {
                    const th = [...header.querySelectorAll('th[aria-colindex]')]
                        .find(cell => cell.textContent === name);
                    const rect = th.getBoundingClientRect();
                    return rect.left + rect.width / 2;
                };
                return JSON.stringify({
                    samples,
                    lastClickedAt,
                    final: offset(),
                    nearOffCentre: centreOf('field_8') - (listRect.left + listRect.width / 2),
                    farOffCentre: centreOf('field_47') - (listRect.left + listRect.width / 2),
                });
            })()`),
      );
      expect(!storm.error, storm.error ?? "");
      // The last click owns the glide. The attempt-based version could apply a *previous*
      // target after the newer click, which is the visible back-and-forth this guards.
      const after = storm.samples.filter((sample) => sample.t >= storm.lastClickedAt);
      expect(after.length >= 4, `only ${after.length} frame(s) sampled after the last click`);
      const final = storm.samples[storm.samples.length - 1].x;
      let away = 0;
      for (let index = 1; index < after.length; index++) {
        const previous = Math.abs(after[index - 1].x - final);
        const current = Math.abs(after[index].x - final);
        if (current > previous + 3) away += current - previous;
      }
      expect(away <= 3, `the glide moved ${Math.round(away)}px away from the requested field`);
      expect(
        Math.abs(storm.nearOffCentre) <= 2,
        `the last click's field is ${storm.nearOffCentre}px off centre`,
      );
      expect(
        Math.abs(storm.farOffCentre) > 1000,
        "the grid stayed on an earlier click's column, not the last click's",
      );
      return `5 clicks: last wins, ${Math.round(Math.abs(storm.farOffCentre))}px from the farthest earlier field`;
    },
  },
];
