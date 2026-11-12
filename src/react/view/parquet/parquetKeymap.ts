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

const MOVES: Record<string, [number, number]> = {
  ArrowDown: [1, 0],
  ArrowUp: [-1, 0],
  ArrowRight: [0, 1],
  ArrowLeft: [0, -1],
  Home: [0, -Infinity],
  End: [0, Infinity],
};

/**
 * Pure keymap for the parquet grid. It decides what a key means (page turn, reveal, inspect,
 * copy) without touching DOM or React state; the caller performs the action. This is the part
 * that used to hide page-edge bugs in a 120-line event handler.
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
