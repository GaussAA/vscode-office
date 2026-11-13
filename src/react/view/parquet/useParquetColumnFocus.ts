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
 * Uses native smooth scrolling with retry logic to handle the virtual list's scrollbar rebuild.
 * The synthetic drag approach was removed in favor of simpler, more reliable smooth scrolling.
 */
export function useParquetColumnFocus({ fileInfoRef, tableWrapRef }: UseParquetColumnFocusArgs) {
  /** Field whose column the schema click last brought into view; tints it while browsing. */
  const [activeColumn, setActiveColumn] = useState<number | null>(null);

  const focusColumn = useCallback(
    (position: number, mark = true) => {
      if (mark) setActiveColumn(position);
      const colIndex = position + 2;

      const bodyOffset = (): number => {
        const wrap = tableWrapRef.current;
        if (!wrap) return 0;
        const inner = wrap.querySelector<HTMLElement>(".ant-table-tbody-virtual-holder-inner");
        if (inner) return wrap.getBoundingClientRect().left - inner.getBoundingClientRect().left;
        const body = wrap.querySelector<HTMLElement>(".ant-table-body, .ant-table-content");
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
        const centred =
          Math.abs(wrapRect.left + Math.max(0, (wrapRect.width - rect.width) / 2) - rect.left) < 2;
        const header = wrap.querySelector<HTMLElement>(
          `.ant-table-header th[aria-colindex="${colIndex}"]`,
        );
        const aligned = !header || Math.abs(header.getBoundingClientRect().left - rect.left) < 2;
        return centred && aligned;
      };

      // Wall-clock budget for retries: the virtual list may rebuild its scrollbar when the
      // active column changes, so we retry until settled or timeout.
      const deadline = Date.now() + 800;

      const scrollOnce = () => {
        const wrap = tableWrapRef.current;
        if (!wrap) return;
        const wrapRect = wrap.getBoundingClientRect();
        // The header renders every column (it is not virtualised), so it is the reliable count.
        const headerCols = wrap.querySelectorAll(".ant-table-header th[aria-colindex]").length;
        const columnCount =
          headerCols > 0 ? headerCols - 1 : (fileInfoRef.current?.columns.length ?? 0);
        const contentWidth =
          columnCount > 0
            ? INDEX_COLUMN_WIDTH + (columnCount + 1) * DATA_COLUMN_WIDTH
            : (wrap.querySelector<HTMLElement>(".ant-table-tbody-virtual-holder-inner")
                ?.scrollWidth ?? 0);
        const maxScroll = Math.max(0, contentWidth - wrapRect.width);
        if (maxScroll <= 0) {
          syncHeader();
          return;
        }

        // An off-screen column is not rendered at all, so there is nothing to measure: fall back
        // to the layout arithmetic, then let the verification pass correct any drift.
        const cell = wrap.querySelector<HTMLElement>(
          `[role="gridcell"][aria-colindex="${colIndex}"]`,
        );
        const desired = cell
          ? (() => {
              const rect = cell.getBoundingClientRect();
              const centred = wrapRect.left + Math.max(0, (wrapRect.width - rect.width) / 2);
              // Increasing the offset moves the content left, so the offset we want is the
              // current one plus however far the cell still has to travel left.
              return bodyOffset() + (rect.left - centred);
            })()
          : INDEX_COLUMN_WIDTH +
            position * DATA_COLUMN_WIDTH -
            Math.max(0, (wrapRect.width - DATA_COLUMN_WIDTH) / 2);
        const target = Math.max(0, Math.min(maxScroll, desired));

        const body = wrap.querySelector<HTMLElement>(".ant-table-body, .ant-table-content");
        if (body && Math.abs(target - body.scrollLeft) >= 1) {
          const behavior = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
            ? "auto"
            : "smooth";
          body.scrollTo({ left: target, behavior });
        }
        syncHeader();
      };

      // Let the active column commit, then verify and retry: the virtual table rebuilds its
      // scrollbar when a column class changes, so an attempt can land on a detached track.
      const attempt = () => {
        scrollOnce();
        requestAnimationFrame(() => {
          syncHeader();
          if (isSettled() || Date.now() > deadline) return;
          // Retry after a short delay to allow smooth scroll to progress
          setTimeout(attempt, 50);
        });
      };
      requestAnimationFrame(attempt);
    },
    [fileInfoRef, tableWrapRef],
  );

  return { activeColumn, setActiveColumn, focusColumn };
}
