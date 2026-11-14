import { useCallback, useRef, useState } from "react";
import type { CellCursor } from "./parquetCell.tsx";

interface UseParquetCursorOptions {
  onCursorChange?: (cursor: CellCursor | null) => void;
}

/**
 * Manages cell cursor state and navigation for the Parquet table.
 *
 * The cursor is kept in both state and ref:
 * - State triggers React re-renders
 * - Ref allows rapid keyboard navigation before re-renders
 */
export function useParquetCursor(options: UseParquetCursorOptions = {}) {
  const [cursor, setCursor] = useState<CellCursor | null>(null);
  const cursorRef = useRef<CellCursor | null>(null);

  const selectCell = useCallback(
    (next: CellCursor | null) => {
      cursorRef.current = next;
      setCursor(next);
      options.onCursorChange?.(next);
    },
    [options],
  );

  const clearCursor = useCallback(() => {
    selectCell(null);
  }, [selectCell]);

  const moveCursor = useCallback(
    (delta: { row?: number; col?: number }) => {
      const current = cursorRef.current;
      if (!current) return;

      const nextRow = current.row + (delta.row ?? 0);
      const nextCol = current.col + (delta.col ?? 0);

      selectCell({
        row: nextRow,
        col: nextCol,
      });
    },
    [selectCell],
  );

  return {
    cursor,
    cursorRef,
    selectCell,
    clearCursor,
    moveCursor,
  };
}
