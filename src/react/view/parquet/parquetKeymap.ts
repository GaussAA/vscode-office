/**
 * Keyboard Navigation for Parquet Viewer
 *
 * Pure functional keymap that translates keyboard events into semantic actions.
 * Handles complex navigation including:
 * - Arrow key cell movement
 * - Page up/down navigation
 * - Home/End key shortcuts
 * - Ctrl/Cmd modifiers for document-level jumps
 * - Edge case handling (page boundaries, wrapping)
 *
 * This is a pure function that returns actions without side effects,
 * making it easy to test and maintain. The caller (React component)
 * performs the actual state updates.
 *
 * @module parquetKeymap
 */

export type ParquetKeyAction =
  | { type: "escape" }
  | { type: "inspect" }
  | { type: "copy" }
  | { type: "turn"; page: number; where: "first" | "last" }
  | { type: "reveal"; row: number; col: number }
  | { type: "none" };

interface ParquetKeyInput {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  cursor: { row: number; col: number } | null;
  rows: number;
  cols: number;
  page: number;
  pageCount: number;
  visibleRows: number;
  hasCopy: boolean;
}

/** Arrow key movement deltas: [rowDelta, colDelta] */
const MOVES: Record<string, [number, number]> = {
  ArrowDown: [1, 0],
  ArrowUp: [-1, 0],
  ArrowRight: [0, 1],
  ArrowLeft: [0, -1],
  Home: [0, -Infinity],
  End: [0, Infinity],
};

/**
 * Resolve a keyboard event to a semantic action.
 *
 * Pure function that decides what a keypress means without side effects.
 * Handles navigation, inspection, copy, and page turns.
 *
 * Key behaviors:
 * - Arrow keys: Move cursor within page
 * - Page Up/Down: Navigate pages
 * - Home/End: Move to start/end of row
 * - Ctrl+Home/End: Jump to first/last page
 * - Enter: Inspect selected cell
 * - Ctrl+C: Copy cell value
 * - Escape: Close inspector/clear selection
 *
 * @param input - Current state and key event
 * @returns The action to perform
 * @example
 * ```ts
 * const action = resolveParquetKey({
 *   key: "ArrowDown",
 *   cursor: { row: 5, col: 2 },
 *   rows: 1000,
 *   // ... other state
 * });
 * // action = { type: "reveal", row: 6, col: 2 }
 * ```
 */
export function resolveParquetKey({
  key,
  ctrlKey,
  metaKey,
  cursor,
  rows,
  cols,
  page,
  pageCount,
  visibleRows,
  hasCopy,
}: ParquetKeyInput): ParquetKeyAction {
  if (key === "Escape") return { type: "escape" };
  if (key === "Enter") return { type: "inspect" };
  const totalRows = Math.max(1, rows);
  const totalCols = Math.max(1, cols);
  const pages = Math.max(1, pageCount);
  const base = cursor ?? { row: 0, col: 0 };

  if ((ctrlKey || metaKey) && (key === "Home" || key === "End")) {
    return {
      type: "turn",
      page: key === "Home" ? 0 : pages - 1,
      where: key === "Home" ? "first" : "last",
    };
  }
  if (key === "PageDown") {
    if (base.row + visibleRows <= totalRows - 1) {
      return { type: "reveal", row: base.row + visibleRows, col: base.col };
    }
    return { type: "turn", page: Math.min(pages - 1, page + 1), where: "first" };
  }
  if (key === "PageUp") {
    if (base.row - visibleRows >= 0) {
      return { type: "reveal", row: base.row - visibleRows, col: base.col };
    }
    return { type: "turn", page: Math.max(0, page - 1), where: "last" };
  }
  // Arrows walk off the page into the next one instead of stopping dead.
  if (key === "ArrowDown" && cursor && cursor.row >= totalRows - 1) {
    return { type: "turn", page: Math.min(pages - 1, page + 1), where: "first" };
  }
  if (key === "ArrowUp" && cursor && cursor.row === 0) {
    return { type: "turn", page: Math.max(0, page - 1), where: "last" };
  }
  if ((ctrlKey || metaKey) && key.toLowerCase() === "c") {
    return hasCopy ? { type: "copy" } : { type: "none" };
  }

  const move = MOVES[key];
  if (!move) {
    // Letters and modifiers must not cold-start the grid. Only a navigation key does.
    return { type: "none" };
  }
  if (!cursor) return { type: "reveal", row: 0, col: 0 };
  return {
    type: "reveal",
    row: Math.max(0, Math.min(totalRows - 1, base.row + move[0])),
    col:
      move[1] === -Infinity
        ? 0
        : move[1] === Infinity
          ? totalCols - 1
          : Math.max(0, Math.min(totalCols - 1, base.col + move[1])),
  };
}
