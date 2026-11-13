import { clickNextPage, expect, json, openParquet } from "../helpers.mjs";

/**
 * Interaction smoothness, measured instead of described (ADR-0022 decision 4).
 *
 * These scenarios record what the browser itself reports — long tasks and long animation frames
 * during paging, scrolling and selecting — and print the numbers. They deliberately do not set a
 * threshold yet: the first job is a baseline, and a threshold invented before the baseline would
 * be a ceiling picked to fit whatever today's machine happened to do.
 *
 * The 250k-row fixture is deliberate: a 300-row table never produces a frame gap, so measuring
 * it would be measuring the scenario, not the viewer.
 *
 * What they *do* assert is that the collector is alive. A metrics scenario that silently records
 * nothing is worse than none: it is green in exactly the case where the measurement broke.
 */

/** The 250k-row fixture: a small file cannot produce a frame gap worth measuring. */
async function expectBigFixture(page) {
  const range = await page.evaluate(
    `document.querySelector('.parquet-viewer__pager-info')?.innerText ?? ''`,
  );
  // The pager formats with a locale separator: 250,000.
  if (!/250[,.]?000/.test(range)) {
    throw new Error(`measuring the wrong fixture: pager says ${JSON.stringify(range)}`);
  }
}

/**
 * The ceiling, set from the numbers two CI rounds and three local runs agreed on: **zero** frame
 * gaps ≥ 50 ms in every interaction, on the 250k-row fixture. One gap under 150 ms is tolerated
 * for a GC pause; anything beyond is the order-of-magnitude regression this guards
 * (ADR-0022 decision 4). The only direction from here is down.
 */
const MAX_GAP_MS = 150;
const MAX_GAPS = 1;

function summarize(raw, label) {
  const longFrames = raw.longFrames ?? [];
  const loafs = raw.loafs ?? [];
  const longest = longFrames.reduce((max, entry) => Math.max(max, entry.duration), 0);
  const blocked = loafs.reduce((sum, entry) => sum + (entry.blocking ?? 0), 0);
  return {
    label,
    longFrames: longFrames.length,
    longest,
    loafs: loafs.length,
    blocked,
  };
}

function describe(sample) {
  if (sample.longest > MAX_GAP_MS || sample.longFrames > MAX_GAPS) {
    throw new Error(
      `${sample.label} produced ${sample.longFrames} frame gap(s), longest ${sample.longest} ms ` +
        `(ceiling ${MAX_GAPS} gap / ${MAX_GAP_MS} ms). Paging means a heavier page decode or row ` +
        `render; scrolling means the virtual table's scrollbar work grew; selecting means the ` +
        `value panel re-renders more than it used to.`,
    );
  }
  return (
    `${sample.label}: ${sample.longFrames} long frame(s), longest ${sample.longest} ms, ` +
    `${sample.loafs} long frame(s), ${sample.blocked} ms blocked`
  );
}

/** Read the collected frames and fail if the observer was never installed. */
async function framesOf(page) {
  const raw = json(await page.frames());
  if (typeof raw.started !== "number") {
    throw new Error(
      "the frame observer is not installed: interaction smoothness cannot be measured",
    );
  }
  return raw;
}

export default [
  {
    name: "parquet-frames-observer",
    async run({ page, base }) {
      // A run that reports zero long tasks is only good news if the observer can report one.
      // This deliberately blocks the main thread for 120 ms and requires the collector to see
      // it; without this, a broken observer and a smooth viewer look identical.
      await openParquet(page, base);
      await page.clearFrames();
      await page.evaluate(`(() => {
        const end = performance.now() + 120;
        while (performance.now() < end) {
          // busy wait: a long task is exactly this
        }
      })()`);
      await page.sleep(250);
      const probe = json(
        await page.evaluate(`(async () => {
                const seen = [];
                try {
                    const observer = new PerformanceObserver((list) => {
                        for (const entry of list.getEntries()) seen.push(entry.duration);
                    });
                    observer.observe({ type: 'longtask' });
                } catch (error) {
                    return JSON.stringify({ error: String(error) });
                }
                const end = performance.now() + 120;
                while (performance.now() < end) {}
                await new Promise((resolve) => setTimeout(resolve, 250));
                return JSON.stringify({ seen, supported: PerformanceObserver.supportedEntryTypes });
            })()`),
      );
      const raw = await framesOf(page);
      const longFrames = raw.longFrames ?? [];
      const longest = longFrames.reduce((max, entry) => Math.max(max, entry.duration), 0);
      expect(
        longFrames.length > 0 && longest >= 100,
        `the frame collector did not report a deliberate 120 ms stall (frames ${longFrames.length}, longest ${longest} ms, probe ${JSON.stringify(probe)})`,
      );
      return `observer is live: 120 ms stall reported as ${longest} ms long task`;
    },
  },
  {
    name: "parquet-frames-paging",
    async run({ page, base }) {
      await openParquet(page, base, "?big=1");
      await expectBigFixture(page);
      await page.clearFrames();
      for (let turn = 0; turn < 5; turn += 1) {
        await clickNextPage(page);
        await page.sleep(80);
      }
      const sample = summarize(await framesOf(page), "5 page turns");
      return describe(sample);
    },
  },
  {
    name: "parquet-frames-scroll",
    async run({ page, base }) {
      await openParquet(page, base, "?big=1");
      await expectBigFixture(page);
      await page.clearFrames();
      // Horizontal travel exercises the virtual table's own scrollbar; vertical travel uses the
      // keyboard path a keyboard user actually has.
      await page.evaluate(`(() => {
        const inner = document.querySelector('.ant-table-tbody-virtual-holder-inner');
        const wrap = document.querySelector('.parquet-viewer__table-wrap');
        if (!inner || !wrap) return false;
        const max = inner.scrollWidth - wrap.clientWidth;
        for (const step of [0.25, 0.5, 0.75, 1]) {
          wrap.dispatchEvent(new Event('scroll'));
          wrap.scrollLeft = max * step;
        }
        return true;
      })()`);
      for (let step = 0; step < 5; step += 1) {
        await page.evaluate(
          `document.querySelector('.parquet-viewer__table-wrap')?.dispatchEvent(
             new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true }))`,
        );
        await page.sleep(60);
      }
      const sample = summarize(await framesOf(page), "scroll + PageDown ×5");
      return describe(sample);
    },
  },
  {
    name: "parquet-frames-select",
    async run({ page, base }) {
      await openParquet(page, base, "?big=1");
      await expectBigFixture(page);
      await page.clearFrames();
      const selected = await page.evaluate(`(() => {
        const cells = [...document.querySelectorAll('.ant-table-tbody-virtual .ant-table-cell')];
        const targets = cells.filter((cell) => cell.querySelector('.parquet-viewer__cell')).slice(0, 20);
        for (const cell of targets) cell.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        return targets.length;
      })()`);
      expect(selected === 20, `expected 20 selectable cells, found ${selected}`);
      await page.sleep(120);
      const sample = summarize(await framesOf(page), "20 selections");
      return describe(sample);
    },
  },
];
