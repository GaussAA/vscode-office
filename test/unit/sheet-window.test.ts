import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_SCROLL_HEIGHT,
  clampScrollTop,
  scrollHeightFor,
  scrollTopForRow,
  visibleRange,
} from "@/react/view/excel/sheetWindow";

/**
 * Phase 2 of ADR-0017. Synthetic scrolling fails at the edges — a blank last page, a row that
 * cannot be reached, spacers that do not add up to the claimed height — so the arithmetic is
 * pinned here instead of being discovered in a screenshot.
 */

const viewport = { rowHeight: 24, viewportHeight: 240, totalRows: 1000, overscan: 4 };

test("window: the first page starts at row 0 and claims the full height", () => {
  const range = visibleRange(0, viewport);

  assert.equal(range.start, 0);
  assert.equal(range.end, 10 + viewport.overscan);
  assert.equal(range.offsetTop, 0);
  assert.equal(range.totalHeight, 24_000);
  assert.equal(
    range.offsetTop + (range.end - range.start) * 24 + range.offsetBottom,
    range.totalHeight,
  );
});

test("window: a middle offset renders the fold plus overscan on both sides", () => {
  const range = visibleRange(24 * 100, viewport);

  assert.equal(range.start, 96);
  assert.equal(range.end, 114);
});

test("window: the last page is not blank and overscan clamps at the end", () => {
  const max = 24_000 - 240;
  const range = visibleRange(max, viewport);

  assert.equal(range.end, 1000);
  assert.equal(range.offsetBottom, 0);
  assert.ok(range.start < 1000, "the last page must render rows");
});

test("window: scroll offsets outside the scrollbar range are clamped", () => {
  assert.equal(clampScrollTop(-50, viewport), 0);
  assert.equal(clampScrollTop(999_999, viewport), 24_000 - 240);
  assert.equal(clampScrollTop(Number.NaN, viewport), 0);
  assert.deepEqual(visibleRange(999_999, viewport), visibleRange(24_000 - 240, viewport));
});

test("window: an empty sheet renders nothing but still claims no height", () => {
  const range = visibleRange(0, { ...viewport, totalRows: 0 });

  assert.deepEqual(range, { start: 0, end: 0, offsetTop: 0, offsetBottom: 0, totalHeight: 0 });
});

test("window: a viewport shorter than one row still renders that row", () => {
  const range = visibleRange(24 * 10, { ...viewport, viewportHeight: 8 });

  assert.ok(range.end > range.start);
});

test("scrollTo: lands the row inside the viewport and clamps to the sheet", () => {
  for (const row of [0, 1, 500, 999, 5000]) {
    const target = Math.min(row, 999);
    const top = scrollTopForRow(row, viewport);
    const range = visibleRange(top, viewport);
    assert.ok(
      target >= range.start && target < range.end,
      `row ${target} is outside ${range.start}..${range.end} at scrollTop ${top}`,
    );
  }
  assert.equal(scrollTopForRow(0, viewport), 0);
  assert.equal(scrollTopForRow(100_000, viewport), 24_000 - 240);
});

const huge = { rowHeight: 22, viewportHeight: 800, totalRows: 2_000_000, overscan: 4 };

test("compressed window: caps the scroll height below the browser limit", () => {
  assert.equal(MAX_SCROLL_HEIGHT, 30_000_000);
  assert.equal(scrollHeightFor(huge), MAX_SCROLL_HEIGHT);
  assert.equal(scrollHeightFor(viewport), 24_000);
});

test("compressed window: the last row is reachable through the capped seek bar", () => {
  const max = MAX_SCROLL_HEIGHT - huge.viewportHeight;
  const first = visibleRange(0, huge);
  assert.equal(first.compressed, true);
  assert.equal(first.start, 0);
  assert.equal(first.totalHeight, MAX_SCROLL_HEIGHT);

  const last = visibleRange(max, huge);
  assert.equal(last.compressed, true);
  assert.equal(last.end, huge.totalRows);
  assert.equal(last.start, huge.totalRows - (last.end - last.start));
  assert.ok(last.start <= huge.totalRows - 1 && huge.totalRows - 1 < last.end);
  assert.equal(clampScrollTop(Number.MAX_SAFE_INTEGER, huge), max);
  assert.equal(scrollTopForRow(huge.totalRows - 1, huge), max);
});

test("compressed window: a middle seek maps monotonically to a row window", () => {
  const max = MAX_SCROLL_HEIGHT - huge.viewportHeight;
  const middle = visibleRange(max / 2, huge);
  assert.ok(middle.start > 0 && middle.end < huge.totalRows);
  assert.equal(middle.end - middle.start, Math.floor(huge.viewportHeight / huge.rowHeight));
});
