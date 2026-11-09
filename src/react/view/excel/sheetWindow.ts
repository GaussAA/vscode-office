/**
 * Which rows a windowed grid should render (phase 2 of ADR-0017).
 *
 * The grid keeps its own scroll offset and asks this module two questions: "which rows are
 * visible, plus a little overscan" and "where do I put the scroll offset to show row N". Pure
 * arithmetic on purpose — synthetic scrolling is the part of a windowed table that silently
 * goes wrong at the ends (blank last page, a row that cannot be reached, a spacer that is one
 * row too tall), and it is testable without a DOM.
 */

export interface SheetViewport {
  /** Uniform row height in pixels; the grid needs fixed rows for synthetic scrolling. */
  rowHeight: number;
  viewportHeight: number;
  totalRows: number;
  /** Rows rendered outside the fold on each side, so fast scrolling does not flash blank. */
  overscan?: number;
}

export interface VisibleRange {
  /** First rendered row (inclusive). */
  start: number;
  /** Last rendered row (exclusive). */
  end: number;
  /** Spacer height above the rendered block. */
  offsetTop: number;
  /** Spacer height below the rendered block. */
  offsetBottom: number;
  /** Height the scroll container must claim so the scrollbar reflects every row. */
  totalHeight: number;
}

const DEFAULT_OVERSCAN = 4;

/** Clamp to the range the scrollbar can actually produce. */
export function clampScrollTop(scrollTop: number, viewport: SheetViewport): number {
  const totalHeight = Math.max(0, viewport.totalRows * viewport.rowHeight);
  const max = Math.max(0, totalHeight - viewport.viewportHeight);
  if (!Number.isFinite(scrollTop) || scrollTop <= 0) return 0;
  return Math.min(scrollTop, max);
}

/**
 * Visible rows for a scroll offset.
 *
 * `offsetBottom` is the remainder so `offsetTop + rendered + offsetBottom === totalHeight`
 * always holds; deriving it from the same numbers is what keeps the last page from being
 * blank or the row count from drifting.
 */
export function visibleRange(scrollTop: number, viewport: SheetViewport): VisibleRange {
  const { rowHeight, viewportHeight, totalRows } = viewport;
  const overscan = Math.max(0, viewport.overscan ?? DEFAULT_OVERSCAN);
  const totalHeight = Math.max(0, totalRows * rowHeight);
  const top = clampScrollTop(scrollTop, viewport);
  if (totalRows <= 0 || rowHeight <= 0) {
    return { start: 0, end: 0, offsetTop: 0, offsetBottom: totalHeight, totalHeight };
  }
  const firstVisible = Math.floor(top / rowHeight);
  const lastVisible = Math.ceil((top + Math.max(0, viewportHeight)) / rowHeight);
  const start = Math.max(0, firstVisible - overscan);
  const end = Math.min(totalRows, Math.max(start + 1, lastVisible + overscan));
  return {
    start,
    end,
    offsetTop: start * rowHeight,
    offsetBottom: totalHeight - end * rowHeight,
    totalHeight,
  };
}

/**
 * Scroll offset that shows `row`, keeping it inside the viewport.
 *
 * Rows already comfortably in view do not move the grid: jumping to a visible row should not
 * scroll the sheet the user is reading.
 */
export function scrollTopForRow(row: number, viewport: SheetViewport): number {
  const { rowHeight, viewportHeight, totalRows } = viewport;
  if (totalRows <= 0 || rowHeight <= 0) return 0;
  const target = Math.max(0, Math.min(row, totalRows - 1));
  const max = Math.max(0, totalRows * rowHeight - viewportHeight);
  // Center the row in the viewport, then clamp to what the scrollbar can produce.
  const centered = target * rowHeight - Math.max(0, viewportHeight - rowHeight) / 2;
  return Math.max(0, Math.min(max, centered));
}
