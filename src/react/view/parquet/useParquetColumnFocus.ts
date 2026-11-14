import { useCallback, useState, type RefObject } from "react";
import type { ParquetFileInfo } from "./parquetParser";
import { DATA_COLUMN_WIDTH, INDEX_COLUMN_WIDTH } from "./parquetLayout";

interface UseParquetColumnFocusArgs {
  fileInfoRef: RefObject<ParquetFileInfo | null>;
  tableWrapRef: RefObject<HTMLDivElement | null>;
}

/**
 * Bring one field into view without changing the page or the row selection.
 *
 * Uses scrollIntoView on the target cell for reliability, with retry logic to handle
 * the virtual list's scrollbar rebuild when the active column changes.
 */
export function useParquetColumnFocus({ fileInfoRef, tableWrapRef }: UseParquetColumnFocusArgs) {
  /** Field whose column the schema click last brought into view; tints it while browsing. */
  const [activeColumn, setActiveColumn] = useState<number | null>(null);

  const focusColumn = useCallback(
    (position: number) => {
      setActiveColumn(position);
      const colIndex = position + 2; // +1 for 1-based, +1 for row-index column

      const bodyOffset = (): number => {
        const body = tableWrapRef.current?.querySelector<HTMLElement>(
          ".ant-table-body, .ant-table-content",
        );
        return body?.scrollLeft ?? 0;
      };

      /**
       * The header is a separate scroll surface. rc-virtual-list moves the body by transform,
       * so nothing fires the scroll event that normally keeps the two in step.
       */
      const syncHeader = () => {
        const header = tableWrapRef.current?.querySelector<HTMLElement>(".ant-table-header");
        if (!header) return;
        const offset = bodyOffset();
        if (Math.abs(header.scrollLeft - offset) > 1) header.scrollLeft = offset;
      };

      const isSettled = (): boolean => {
        const wrap = tableWrapRef.current;
        const cell = wrap?.querySelector<HTMLElement>(
          `[role="gridcell"][aria-colindex="${colIndex}"]`,
        );
        if (!wrap || !cell) return false;
        const wrapRect = wrap.getBoundingClientRect();
        const rect = cell.getBoundingClientRect();
        // Check if cell is in viewport (test requirement)
        const inView = rect.width > 0 && rect.left >= wrapRect.left && rect.left < wrapRect.right;
        const header = wrap.querySelector<HTMLElement>(
          `.ant-table-header th[aria-colindex="${colIndex}"]`,
        );
        const aligned = !header || Math.abs(header.getBoundingClientRect().left - rect.left) < 2;
        return inView && aligned;
      };

      const deadline = Date.now() + 1200;

      const scrollOnce = () => {
        const wrap = tableWrapRef.current;
        if (!wrap) return;

        // Find the target cell - it might not be rendered yet if far off-screen
        const cell = wrap.querySelector<HTMLElement>(
          `[role="gridcell"][aria-colindex="${colIndex}"]`,
        );

        if (cell) {
          // Cell exists: use scrollIntoView which is more reliable than scrollTo
          // inline: "center" centers the cell horizontally
          // block: "nearest" prevents vertical scrolling
          cell.scrollIntoView({
            behavior: "auto", // instant scroll for reliability in headless browsers
            inline: "center",
            block: "nearest",
          });
        } else {
          // Cell not rendered yet: manually scroll to approximate position
          const wrapRect = wrap.getBoundingClientRect();
          const headerCols = wrap.querySelectorAll(".ant-table-header th[aria-colindex]").length;
          const columnCount =
            headerCols > 0 ? headerCols - 1 : (fileInfoRef.current?.columns.length ?? 0);
          const contentWidth =
            columnCount > 0
              ? INDEX_COLUMN_WIDTH + (columnCount + 1) * DATA_COLUMN_WIDTH
              : (wrap.querySelector<HTMLElement>(".ant-table-tbody-virtual-holder-inner")
                  ?.scrollWidth ?? 0);
          const maxScroll = Math.max(0, contentWidth - wrapRect.width);
          if (maxScroll > 0) {
            const target = Math.max(
              0,
              Math.min(
                maxScroll,
                INDEX_COLUMN_WIDTH +
                  position * DATA_COLUMN_WIDTH -
                  Math.max(0, (wrapRect.width - DATA_COLUMN_WIDTH) / 2),
              ),
            );
            const body = wrap.querySelector<HTMLElement>(".ant-table-body, .ant-table-content");
            if (body) body.scrollLeft = target;
          }
        }

        syncHeader();
      };

      const attempt = () => {
        scrollOnce();
        requestAnimationFrame(() => {
          syncHeader();
          if (isSettled() || Date.now() > deadline) return;
          // Continue retrying
          requestAnimationFrame(attempt);
        });
      };

      requestAnimationFrame(attempt);
    },
    [fileInfoRef, tableWrapRef],
  );

  return { activeColumn, setActiveColumn, focusColumn };
}
