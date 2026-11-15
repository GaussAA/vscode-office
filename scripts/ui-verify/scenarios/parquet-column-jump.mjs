import { expect, json, openParquet } from "../helpers.mjs";

/**
 * Column jump animation: clicking a field in the schema list should smoothly scroll the table
 * to bring that column into view, without jank or layout thrashing.
 *
 * This scenario measures the behavior to detect animation smoothness issues.
 */

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

      const targetColumnIndex = columnCount - 1; // Last column (0-indexed)

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

      // Smoothness: a one-frame jump of the whole distance is not an animation.
      const dist = Math.abs(m.end - m.start);
      const steps = m.moveFrames;
      const summary = `${m.start} → ${m.end} (${Math.round(dist)}px) in ${m.span}ms, ${steps} moving frames, maxStep ${m.maxStep}px, reversals ${m.reversals}, desync ${m.desync}, scrollTo ${m.scrollTo}`;
      console.log("[parquet-column-jump] " + summary + " moves=" + JSON.stringify(m.moves));
      expect(steps >= 4, `not animated: only ${steps} moving frames. ${summary}`);
      expect(
        m.maxStep <= dist * 0.6,
        `one frame covers ${Math.round((m.maxStep / dist) * 100)}% of the distance. ${summary}`,
      );
      return summary;
    },
  },

  {
    name: "parquet-column-jump-no-reduced-motion",
    async run({ page, base, setReducedMotion }) {
      await setReducedMotion(false);
      // Test that column jump respects scroll-behavior: smooth when motion is enabled
      await openParquet(page, base, "?preview=1");

      const tableReady = await page.waitFor(
        `document.querySelectorAll('.ant-table-tbody-virtual .ant-table-row').length > 0`,
      );
      expect(tableReady, "table did not render");

      // Check if smooth scrolling is enabled
      const scrollBehavior = json(
        await page.evaluate(`JSON.stringify({
          bodyScrollBehavior: getComputedStyle(
            document.querySelector('.ant-table-body') || document.documentElement
          ).scrollBehavior,
          prefersReducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        })`),
      );

      // If prefers-reduced-motion is not set, scroll-behavior should allow smooth scrolling
      if (!scrollBehavior.prefersReducedMotion) {
        expect(
          scrollBehavior.bodyScrollBehavior === "smooth" ||
            scrollBehavior.bodyScrollBehavior === "auto",
          `unexpected scroll-behavior: ${scrollBehavior.bodyScrollBehavior}`,
        );
      }

      return `scroll-behavior: ${scrollBehavior.bodyScrollBehavior}, reduced-motion: ${scrollBehavior.prefersReducedMotion}`;
    },
  },
];
