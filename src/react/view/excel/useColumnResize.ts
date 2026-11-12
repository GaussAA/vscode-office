import {
  useCallback,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  clampColumnWidth,
  gridTemplateFor,
} from "./windowedSheetModel";

interface ResizeState {
  column: number;
  startX: number;
  startWidth: number;
}

export interface ColumnResize {
  columnWidths: Record<number, number>;
  gridTemplate: string;
  beginResize: (column: number, event: ReactPointerEvent<HTMLSpanElement>) => void;
  moveResize: (event: ReactPointerEvent<HTMLSpanElement>) => void;
  endResize: (event: ReactPointerEvent<HTMLSpanElement>) => void;
  clearResize: () => void;
  resetColumnWidth: (column: number) => void;
  handleResizeKeyDown: (column: number, event: ReactKeyboardEvent<HTMLSpanElement>) => void;
}

/** Pointer and keyboard column resizing, including pointer capture and the ARIA range. */
export function useColumnResize(columnCount: number): ColumnResize {
  const [columnWidths, setColumnWidths] = useState<Record<number, number>>({});
  const resizeRef = useRef<ResizeState | null>(null);

  const beginResize = useCallback((column: number, event: ReactPointerEvent<HTMLSpanElement>) => {
    const cell = event.currentTarget.parentElement;
    if (!cell) return;
    resizeRef.current = {
      column,
      startX: event.clientX,
      startWidth: cell.getBoundingClientRect().width,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const moveResize = useCallback((event: ReactPointerEvent<HTMLSpanElement>) => {
    const resize = resizeRef.current;
    if (!resize) return;
    const next = clampColumnWidth(resize.startWidth + event.clientX - resize.startX);
    setColumnWidths((current) =>
      current[resize.column] === next ? current : { ...current, [resize.column]: next },
    );
    event.preventDefault();
  }, []);

  const endResize = useCallback((event: ReactPointerEvent<HTMLSpanElement>) => {
    resizeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const clearResize = useCallback(() => {
    resizeRef.current = null;
  }, []);

  const resetColumnWidth = useCallback((column: number) => {
    setColumnWidths((current) => {
      if (current[column] === undefined) return current;
      const next = { ...current };
      delete next[column];
      return next;
    });
  }, []);

  const handleResizeKeyDown = useCallback(
    (column: number, event: ReactKeyboardEvent<HTMLSpanElement>) => {
      const cell = event.currentTarget.parentElement;
      const current =
        columnWidths[column] ?? cell?.getBoundingClientRect().width ?? MIN_COLUMN_WIDTH;
      let next: number | undefined;
      if (event.key === "ArrowLeft") {
        next = current - (event.shiftKey ? 40 : 10);
      } else if (event.key === "ArrowRight") {
        next = current + (event.shiftKey ? 40 : 10);
      } else if (event.key === "Home") {
        resetColumnWidth(column);
        event.preventDefault();
        event.stopPropagation();
        return;
      } else if (event.key === "End") {
        next = MAX_COLUMN_WIDTH;
      }
      if (next === undefined) return;
      event.preventDefault();
      event.stopPropagation();
      setColumnWidths((widths) => ({ ...widths, [column]: clampColumnWidth(next) }));
    },
    [columnWidths, resetColumnWidth],
  );

  return {
    columnWidths,
    gridTemplate: gridTemplateFor(columnWidths, columnCount),
    beginResize,
    moveResize,
    endResize,
    clearResize,
    resetColumnWidth,
    handleResizeKeyDown,
  };
}
