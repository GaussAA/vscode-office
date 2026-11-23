/**
 * Interaction-frame sampling shared by the JSONL and JSON smoothness scenarios (ADR-0030).
 *
 * The collector itself lives in `browser.mjs`: it records `requestAnimationFrame` deltas and
 * long-animation-frame entries into `window.__dshFrames`. These helpers turn that into a
 * verdict, using the same ceiling ADR-0022 set for parquet: zero gaps ≥ 50 ms, one gap under
 * 150 ms tolerated for a GC pause, anything beyond is an order-of-magnitude regression.
 *
 * The JSONL/JSON ceilings were set after the first baseline round (see
 * `docs/agents/perf.md`); they are not invented before the measurement.
 */

const MAX_GAP_MS = 150;
const MAX_GAPS = 1;

export function summarizeFrames(raw, label) {
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

/** What went wrong, so the failure names the likely cause instead of only the number. */
export function describeFrames(sample, hint) {
  if (sample.longest > MAX_GAP_MS || sample.longFrames > MAX_GAPS) {
    throw new Error(
      `${sample.label} produced ${sample.longFrames} frame gap(s), longest ${sample.longest} ms ` +
        `(ceiling ${MAX_GAPS} gap / ${MAX_GAP_MS} ms). ${hint}`,
    );
  }
  return (
    `${sample.label}: ${sample.longFrames} long frame(s), longest ${sample.longest} ms, ` +
    `${sample.blocked} ms blocked`
  );
}

/** Read the collected frames and fail if the observer was never installed. */
export async function framesOf(page) {
  const raw = JSON.parse(await page.frames());
  if (typeof raw.started !== "number") {
    throw new Error(
      "the frame observer is not installed: interaction smoothness cannot be measured",
    );
  }
  return raw;
}
