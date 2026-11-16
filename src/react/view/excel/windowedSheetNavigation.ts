/**
 * Cell navigation and scroll-coordinate rules for the windowed sheet, with no React and no DOM.
 *
 * Two coordinate systems meet here, and mixing them up is the usual bug:
 *  - **body rows**: 0-based rows of the header-free body source (what selection, find and the
 *    window reader use);
 *  - **scroller pixels**: `scrollTop` of the grid element, which also contains the frozen
 *    header, so the body starts `HEADER_HEIGHT` below zero (except in compressed seek mode,
 *    where the scrollbar spans header and capped body and the raw offset is the seek position).
 */
import { scrollTopForRow, type SheetViewport, type VisibleRange } from "./sheetWindow";
import { HEADER_HEIGHT, ROW_HEIGHT } from "./windowedSheetModel";

export interface CellPosition {
  row: number;
  col: number;
}

export interface CellSelection extends CellPosition {
  value: string;
}

export interface GridBounds {
  rowCount: number;
  columnCount: number;
}

/** The key facts navigation needs; `ctrl` means Ctrl or Cmd. */
export interface NavigationKey {
  key: string;
  ctrl: boolean;
}

function clampIndex(value: number, count: number): number {
  return Math.max(0, Math.min(count - 1, value));
}

export function clampCell(cell: CellPosition, bounds: GridBounds): CellPosition {
  return {
    row: clampIndex(cell.row, bounds.rowCount),
    col: clampIndex(cell.col, bounds.columnCount),
  };
}

/** Rows a PageUp/PageDown moves: one viewport minus a row of overlap, never less than one. */
export function pageRows(bodyViewportHeight: number): number {
  return Math.max(1, Math.floor(bodyViewportHeight / ROW_HEIGHT) - 1);
}

/** Where keyboard movement starts when nothing is selected: the first rendered row. */
export function startingCell(
  selected: CellPosition | null,
  range: Pick<VisibleRange, "start"> | null,
): CellPosition {
  return selected ?? { row: range?.start ?? 0, col: 0 };
}

/**
 * The cell a navigation key moves to, clamped to the grid, or null when the key is not a
 * navigation key (the caller must then leave the event alone) or the grid is empty.
 */
export function moveCell(
  from: CellPosition,
  input: NavigationKey,
  bounds: GridBounds,
  page: number,
): CellPosition | null {
  if (bounds.rowCount <= 0) return null;
  let row = from.row;
  let col = from.col;
  switch (input.key) {
    case "ArrowDown":
      row += 1;
      break;
    case "ArrowUp":
      row -= 1;
      break;
    case "ArrowLeft":
      col -= 1;
      break;
    case "ArrowRight":
      col += 1;
      break;
    case "PageDown":
      row += page;
      break;
    case "PageUp":
      row -= page;
      break;
    case "Home":
      if (input.ctrl) row = 0;
      col = 0;
      break;
    case "End":
      if (input.ctrl) row = bounds.rowCount - 1;
      col = bounds.columnCount - 1;
      break;
    default:
      return null;
  }
  return clampCell({ row, col }, bounds);
}

export interface ResolvedSelection {
  selection: CellSelection;
  /** The row is outside the rendered window, so its value has to be read from the source. */
  needsRead: boolean;
}

/**
 * Select a cell: clamp it and take its value from the rendered rows. A row that is not
 * rendered gets an empty value now and `needsRead`, so the caller can fill it in afterwards.
 * Null when the grid is empty.
 */
export function resolveSelection(
  cell: CellPosition,
  bounds: GridBounds,
  rows: readonly (readonly string[])[],
  rangeStart: number,
): ResolvedSelection | null {
  if (bounds.rowCount <= 0) return null;
  const { row, col } = clampCell(cell, bounds);
  const rendered = rows[row - rangeStart];
  return {
    selection: { row, col, value: rendered?.[col] ?? "" },
    needsRead: !rendered,
  };
}

/**
 * Apply a late source read to the selection. It only lands on the cell it was requested for;
 * if the user has moved on, the current selection is returned untouched.
 */
export function withLoadedValue(
  current: CellSelection | null,
  requested: CellPosition,
  data: readonly string[] | undefined,
): CellSelection | null {
  if (current && current.row === requested.row && current.col === requested.col) {
    return { ...current, value: data?.[requested.col] ?? "" };
  }
  return current;
}

/** Body-row coordinate of the grid's scroll offset (the header is subtracted unless seeking). */
export function bodyScrollTopFor(scrollTop: number, compressed: boolean): number {
  return compressed ? Math.max(0, scrollTop) : Math.max(0, scrollTop - HEADER_HEIGHT);
}

/** Grid `scrollTop` that shows a body row (seek position or header-offset pixels). */
export function scrollerTopForRow(row: number, viewport: SheetViewport): number {
  return HEADER_HEIGHT + scrollTopForRow(row, viewport);
}

export interface RowVisibilityState {
  compressed: boolean;
  range: Pick<VisibleRange, "start" | "end"> | null;
  /** Raw `scrollTop` of the grid element. */
  scrollTop: number;
  bodyViewportHeight: number;
  dataRowCount: number;
}

/**
 * What it takes to bring a body row into view:
 *  - `none`: already visible;
 *  - `seek`: compressed mode, jump with the seek-bar mapping (`scrollerTopForRow`);
 *  - `scroll`: normal mode, set the grid's `scrollTop` to `top` (header offset included).
 */
export type RowScroll = { kind: "none" } | { kind: "seek" } | { kind: "scroll"; top: number };

export function rowScrollFor(row: number, state: RowVisibilityState): RowScroll {
  const { compressed, range, scrollTop, bodyViewportHeight, dataRowCount } = state;
  if (compressed) {
    if (range && row >= range.start && row < range.end) return { kind: "none" };
    return { kind: "seek" };
  }
  const top = Math.max(0, scrollTop - HEADER_HEIGHT);
  const rowTop = row * ROW_HEIGHT;
  if (rowTop >= top && rowTop + ROW_HEIGHT <= top + bodyViewportHeight) return { kind: "none" };
  const desired = rowTop < top ? rowTop : rowTop - bodyViewportHeight + ROW_HEIGHT;
  const maxBody = Math.max(0, dataRowCount * ROW_HEIGHT - bodyViewportHeight);
  return { kind: "scroll", top: HEADER_HEIGHT + Math.min(Math.max(0, desired), maxBody) };
}
