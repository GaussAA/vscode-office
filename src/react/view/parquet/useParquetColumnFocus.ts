import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { flushSync } from "react-dom";
import type { TableRef } from "antd/es/table";
import { MOTION_SLOW_MS, motionEnabled } from "../../util/motion";

interface UseParquetColumnFocusArgs {
  tableRef: RefObject<TableRef | null>;
  tableWrapRef: RefObject<HTMLDivElement | null>;
}

/** A frame may land a pixel off; more than this means something else owns the scroll. */
const INTERRUPT_TOLERANCE = 2;
/**
 * Past this many columns the glide stops being motion: every frame re-renders every column of
 * the visible rows, so a very wide table turns the easing into a handful of blocking long
 * tasks. Those tables get the column placed directly, which is what they had before.
 */
const GLIDE_MAX_COLUMNS = 120;

/**
 * antd's `TableRef` only types the row-scrolling half. The virtual body's imperative handle
 * forwards `left` to rc-virtual-list, which sets the horizontal offset directly — the one way
 * to move that surface without synthesising a drag on its scrollbar.
 */
interface HorizontalTableRef {
  scrollTo(config: { left: number }): void;
}

/**
 * Bring one field's column into view without changing the page or the row selection.
 *
 * The table's horizontal position belongs to rc-virtual-list, not to a scroll port with a
 * native offset: the body is shifted by `margin-left`, and the only exposed control is the drag
 * on its custom scrollbar. The previous implementation synthesised that drag — first with fixed
 * timers, then with an eased mousemove chain — so every click started its own drag and retry
 * chain. Two chains read each other's synthetic coordinates, and a click during an earlier jump
 * landed on whichever chain finished last; the serialised retry loop also kept running for up to
 * 1.2 s after the column arrived, so the *next* click could fight it and rebound.
 *
 * This version owns the offset instead: it measures the column from the header (which renders
 * every column, unlike the virtual body), eases to that offset one frame at a time, and keeps
 * the header in step — so a second click cancels the glide and retargets it from wherever the
 * grid currently is. The duration comes from the motion tokens (ADR-0022); reduced motion
 * places the column directly.
 */
export function useParquetColumnFocus({ tableRef, tableWrapRef }: UseParquetColumnFocusArgs) {
  /** Field whose column the schema click last brought into view; tints it while browsing. */
  const [activeColumn, setActiveColumn] = useState<number | null>(null);
  /** The one pending frame: measurement or glide step. The newest click owns it. */
  const frame = useRef(0);

  /**
   * How far the grid is scrolled horizontally, read from the layout rather than tracked: the
   * body is moved by `margin-left` on the holder's inner element, so the gap between the wrap
   * and that element is the offset currently on screen.
   */
  const bodyOffset = useCallback((): number => {
    const wrap = tableWrapRef.current;
    const inner = wrap?.querySelector<HTMLElement>(".ant-table-tbody-virtual-holder-inner");
    if (!wrap || !inner) return 0;
    return Math.max(0, wrap.getBoundingClientRect().left - inner.getBoundingClientRect().left);
  }, [tableWrapRef]);

  /**
   * The header is a separately shifted surface: rc-table only moves it when the body reports a
   * scroll, and a programmatic offset change reports nothing.
   */
  const syncHeader = useCallback(
    (offset: number) => {
      const header = tableWrapRef.current?.querySelector<HTMLElement>(".ant-table-header");
      if (!header) return;
      if (Math.abs(header.scrollLeft - offset) > 0.5) header.scrollLeft = offset;
    },
    [tableWrapRef],
  );

  const apply = useCallback(
    (offset: number) => {
      // The virtual body's offset is React state inside rc-virtual-list. Left to the default
      // scheduler the commit lands a frame after the header write below, so every step shows
      // labels one column ahead of their values — a shear that reads as the table shaking.
      flushSync(() => {
        (tableRef.current as unknown as HorizontalTableRef | null)?.scrollTo?.({ left: offset });
      });
      syncHeader(offset);
    },
    [syncHeader, tableRef],
  );

  /**
   * Where the column has to sit so that it ends up centred, clamped to the table's real range,
   * plus how many data columns the header rendered.
   *
   * The header renders every column, so its cell exists even when the virtual body has not
   * rendered the target; adding the header's `scrollLeft` puts the cell back into content
   * coordinates, which do not depend on how far the grid happens to be scrolled right now.
   */
  const targetFor = useCallback(
    (position: number): { offset: number; columns: number } | null => {
      const wrap = tableWrapRef.current;
      if (!wrap) return null;
      const header = wrap.querySelector<HTMLElement>(".ant-table-header");
      const viewport = wrap.querySelector<HTMLElement>(".ant-table-tbody-virtual");
      const inner = wrap.querySelector<HTMLElement>(".ant-table-tbody-virtual-holder-inner");
      const headCell = header?.querySelector<HTMLElement>(`th[aria-colindex="${position + 2}"]`);
      if (!header || !headCell || !viewport || !inner) return null;
      const viewportWidth = viewport.clientWidth;
      // A holder that has not been measured yet has no usable centre; a jump computed from it
      // would land off the table for no reason.
      if (viewportWidth <= 0) return null;
      const headerRect = header.getBoundingClientRect();
      const cellRect = headCell.getBoundingClientRect();
      const columnLeft = cellRect.left - headerRect.left + header.scrollLeft;
      const desired = columnLeft + cellRect.width / 2 - viewportWidth / 2;
      return {
        offset: Math.min(Math.max(0, desired), Math.max(0, inner.scrollWidth - viewportWidth)),
        // The ordinal cells are the index column plus one per field.
        columns: header.querySelectorAll("th[aria-colindex]").length - 1,
      };
    },
    [tableWrapRef],
  );

  const stopGlide = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = 0;
  }, []);

  const glideTo = useCallback(
    (target: number) => {
      stopGlide();
      const start = bodyOffset();
      const distance = target - start;
      if (!motionEnabled() || Math.abs(distance) < 1) {
        apply(target);
        return;
      }

      const startedAt = performance.now();
      let applied = start;
      let step = 0;
      const tick = () => {
        // A layout change moved the body while we were easing: the new geometry wins.
        const current = bodyOffset();
        if (step > 0 && Math.abs(current - applied) > INTERRUPT_TOLERANCE) {
          syncHeader(current);
          return;
        }
        const progress = Math.min(1, (performance.now() - startedAt) / MOTION_SLOW_MS);
        applied = start + distance * (1 - (1 - progress) ** 3);
        apply(progress === 1 ? target : applied);
        step += 1;
        if (progress === 1) {
          // The header can clamp a pixel short of the body at the right edge; one more frame
          // settles the labels on the position the body actually reached.
          frame.current = requestAnimationFrame(() => syncHeader(bodyOffset()));
          return;
        }
        frame.current = requestAnimationFrame(tick);
      };
      frame.current = requestAnimationFrame(tick);
    },
    [apply, bodyOffset, stopGlide, syncHeader],
  );

  const focusColumn = useCallback(
    (position: number, mark = true) => {
      setActiveColumn(mark ? position : null);
      // Measure after the click has committed: on a cold start the holder's width can still be
      // zero, and an offset computed from half-measured columns would land somewhere else.
      stopGlide();
      frame.current = requestAnimationFrame(() => {
        frame.current = 0;
        const target = targetFor(position);
        if (!target) return;
        if (target.columns > GLIDE_MAX_COLUMNS) {
          apply(target.offset);
          return;
        }
        glideTo(target.offset);
      });
    },
    [apply, glideTo, stopGlide, targetFor],
  );

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  useEffect(() => {
    // A wheel turn or a press inside the grid is the reader taking over. The glide is one motion
    // token long, but it must not keep pulling the offset away from a gesture that started
    // during it — a wheel turn is applied in its own animation frame.
    const cancel = (event: Event) => {
      const wrap = tableWrapRef.current;
      const target = event.target;
      if (!wrap || !(target instanceof Node) || !wrap.contains(target)) return;
      stopGlide();
    };
    window.addEventListener("wheel", cancel, { passive: true });
    window.addEventListener("pointerdown", cancel, { passive: true });
    return () => {
      window.removeEventListener("wheel", cancel);
      window.removeEventListener("pointerdown", cancel);
    };
  }, [stopGlide, tableWrapRef]);

  return { activeColumn, setActiveColumn, focusColumn };
}
