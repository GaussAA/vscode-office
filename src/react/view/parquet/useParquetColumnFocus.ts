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
 * This lives outside the viewer because the behaviour is a small, testable horizontal-scroll
 * model built on the virtual table's DOM: measure the target instead of computing it from a
 * column width (antd stretches few-column files), keep the separately-scrolled header aligned,
 * and retry for a few frames because the virtual list rebuilds its scrollbar.
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

        // Drag the thumb rather than clicking the track: rc-virtual-list ignores a mousedown
        // whose target is the thumb, and a wide thumb can cover the position that means "the
        // end". A drag is relative, so it works at any thumb size.
        const track = wrap.querySelector<HTMLElement>(
          ".ant-table-tbody-virtual-scrollbar-horizontal",
        );
        const thumb = track?.querySelector<HTMLElement>(".ant-table-tbody-virtual-scrollbar-thumb");
        if (track && thumb) {
          const trackRect = track.getBoundingClientRect();
          const thumbRect = thumb.getBoundingClientRect();
          const offsetRange = trackRect.width - thumbRect.width;
          if (offsetRange > 0 && thumbRect.width > 0) {
            const px = ((target - bodyOffset()) / maxScroll) * offsetRange;
            if (Math.abs(px) < 0.5) {
              syncHeader();
              return;
            }
            const startX = thumbRect.left + thumbRect.width / 2;
            const startY = trackRect.top + trackRect.height / 2;
            // The drag handler reads `pageX`, which a synthetic MouseEvent does not reliably
            // carry (only `clientX` is part of MouseEventInit), so define it explicitly.
            const fire = (
              node: EventTarget,
              type: string,
              x: number,
              init: MouseEventInit = {},
            ) => {
              const event = new MouseEvent(type, {
                bubbles: true,
                cancelable: true,
                clientX: x,
                clientY: startY,
                ...init,
              });
              Object.defineProperty(event, "pageX", { value: x });
              Object.defineProperty(event, "pageY", { value: startY });
              node.dispatchEvent(event);
            };
            fire(thumb, "mousedown", startX, { button: 0, buttons: 1 });
            // The window listeners only exist after React commits `dragging` (post-paint), and
            // the scroll is applied on the frame after the move — releasing in the same tick
            // cancels it, because the drag effect cleans up with `raf.cancel`.
            window.setTimeout(() => {
              fire(window, "mousemove", startX + px * 0.5, { buttons: 1 });
              fire(window, "mousemove", startX + px, { buttons: 1 });
              window.setTimeout(() => {
                fire(window, "mouseup", startX + px, { buttons: 0 });
                window.setTimeout(() => syncHeader(), 32);
              }, 64);
            }, 80);
            return;
          }
        }

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
      // scrollbar when a column class changes, so an attempt can land on a detached track or
      // one whose geometry is still zero. Both are silent.
      requestAnimationFrame(() => {
        let tries = 8;
        const attempt = () => {
          scrollOnce();
          requestAnimationFrame(() => {
            syncHeader();
            if (isSettled() || --tries <= 0) return;
            attempt();
          });
        };
        attempt();
      });
    },
    [fileInfoRef, tableWrapRef],
  );

  return { activeColumn, setActiveColumn, focusColumn };
}
