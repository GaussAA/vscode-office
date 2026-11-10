import { useRef, type HTMLAttributes, type ThHTMLAttributes } from "react";
import { $t } from "../../i18n/i18nConfig.ts";
import { COLUMN_MAX_WIDTH, COLUMN_MIN_WIDTH, DATA_COLUMN_WIDTH } from "./parquetLayout.ts";

/**
 * antd renders the column header as its own `<table>`, and a `table` inside a `grid` is not a
 * valid child of one. Dropping the table role keeps the header cells' explicit `columnheader`
 * roles while the grid underneath owns the rows.
 */
export function PresentationTable(props: HTMLAttributes<HTMLTableElement>) {
  return <table {...props} role="presentation" />;
}

interface ResizableHeaderCellProps extends ThHTMLAttributes<HTMLTableCellElement> {
  /** Column name, used as the key the width is stored under. */
  columnKey?: string;
  onResizeColumn?: (width: number) => void;
  onResetColumn?: () => void;
}

/**
 * A header cell with a drag handle on its right edge.
 *
 * antd has no column resizing and the widths are what the virtual scroller feeds on, so the
 * handle measures the cell it lives in and reports the new width upward. Pointer capture keeps
 * the drag alive when the pointer leaves the 3px strip it started on.
 */
export function ResizableHeaderCell(props: ResizableHeaderCellProps) {
  const { children, columnKey, onResizeColumn, onResetColumn, ...rest } = props;
  const drag = useRef<{ x: number; width: number } | null>(null);
  if (!onResizeColumn) return <th {...rest}>{children}</th>;
  return (
    <th {...rest}>
      {children}
      <span
        className="parquet-viewer__column-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label={$t("parquet.resizeColumn", { name: columnKey ?? "" })}
        title={$t("parquet.resetColumnWidth")}
        tabIndex={0}
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          const cell = event.currentTarget.parentElement;
          if (!cell) return;
          drag.current = { x: event.clientX, width: cell.getBoundingClientRect().width };
          // A synthetic pointer (tests, or a programmatic dispatch) has no active pointer to
          // capture, and setPointerCapture throws for it.
          try {
            event.currentTarget.setPointerCapture(event.pointerId);
          } catch {}
        }}
        onPointerMove={(event) => {
          if (!drag.current) return;
          const next = Math.round(
            Math.max(
              COLUMN_MIN_WIDTH,
              Math.min(COLUMN_MAX_WIDTH, drag.current.width + event.clientX - drag.current.x),
            ),
          );
          onResizeColumn(next);
        }}
        onPointerUp={(event) => {
          drag.current = null;
          try {
            event.currentTarget.releasePointerCapture(event.pointerId);
          } catch {}
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        // Keyboard parity with the pointer: the handle is a separator, so arrows resize it.
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          event.stopPropagation();
          const cell = event.currentTarget.parentElement;
          const current = cell ? Math.round(cell.getBoundingClientRect().width) : DATA_COLUMN_WIDTH;
          const step = event.shiftKey ? 32 : 8;
          onResizeColumn(
            Math.max(
              COLUMN_MIN_WIDTH,
              Math.min(COLUMN_MAX_WIDTH, current + (event.key === "ArrowRight" ? step : -step)),
            ),
          );
        }}
        onDoubleClick={() => onResetColumn?.()}
      />
    </th>
  );
}
