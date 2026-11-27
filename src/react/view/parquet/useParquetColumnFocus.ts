import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { flushSync } from "react-dom";
import type { TableRef } from "antd/es/table";
import { MOTION_SLOW_MS, motionEnabled } from "../../util/motion";

interface UseParquetColumnFocusArgs {
  tableRef: RefObject<TableRef | null>;
  tableWrapRef: RefObject<HTMLDivElement | null>;
  /** Rendered widths by original column position; hidden columns simply never reach the loop. */
  columnWidths: number[];
  /** Absolute positions currently rendered, in table order. */
  visibleColumns: number[];
  /** Width of the always-fixed ordinal column. */
  indexWidth: number;
}

/** Which edge a pinned column sticks to; antd's fixed names. */
export type ParquetPinSide = "start" | "end";

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
export function useParquetColumnFocus({
  tableRef,
  tableWrapRef,
  columnWidths,
  visibleColumns,
  indexWidth,
}: UseParquetColumnFocusArgs) {
  /** Field whose column the schema click last brought into view; tints it while browsing. */
  const [activeColumn, setActiveColumn] = useState<number | null>(null);
  /** The column the schema click pinned. Cell clicks move the tint but never the pin. */
  const [pinnedColumn, setPinnedColumn] = useState<number | null>(null);
  const [pinSide, setPinSide] = useState<ParquetPinSide | null>(null);
  const pinHover = useRef<{ offset: number }>({ offset: 0 });
  /** The one pending frame: measurement or glide step. The newest click owns it. */
  const frame = useRef(0);
  const pinFrame = useRef(0);
  /**
   * A schema click scrolls the column into view; that programmatic glide must not count as the
   * user pushing it off an edge. Pinning starts with the first wheel/pointer gesture after the
   * click, and stops again while the next selection is being brought into view.
   */
  const pinArmed = useRef(false);

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
      const headCell = header?.querySelector<HTMLElement>(`th[data-col-position="${position}"]`);
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
    (position: number, mark = true, preserveActive = false) => {
      if (!mark) {
        // A search jump must not leave (or inherit) a "you picked this field" tint. The
        // exception is a search scoped to the active column: clearing it would leave the
        // scope selector without the column whose results are on screen.
        pinArmed.current = false;
        if (!preserveActive) setActiveColumn(null);
      } else if (activeColumn === position) {
        // The field is already highlighted: the second click dismisses it. That is a
        // selection toggle, not another navigation, so the grid stays where the reader is.
        setActiveColumn(null);
        setPinnedColumn(null);
        setPinSide(null);
        return;
      } else {
        setActiveColumn(position);
        setPinnedColumn(position);
        setPinSide(null);
        pinArmed.current = false;
        pinHover.current.offset = bodyOffset();
      }
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
    [activeColumn, apply, bodyOffset, glideTo, stopGlide, targetFor],
  );

  /**
   * Choose and release the pinned edge from the column's natural position.
   *
   * The virtual body is moved by `margin-left`, which makes a fixed column's `sticky` offset
   * work without a scroll port; this loop only decides *which* edge and when the column has
   * come back far enough to release. Once a side is chosen it is kept until the column is
   * fully inside the viewport again, so reversing direction cannot teleport it across.
   */
  const updatePinSide = useCallback(() => {
    if (!pinArmed.current) return;
    if (pinnedColumn === null) {
      setPinSide((side) => (side === null ? side : null));
      return;
    }
    const visibleIndex = visibleColumns.indexOf(pinnedColumn);
    if (visibleIndex < 0) {
      setPinnedColumn(null);
      setPinSide(null);
      return;
    }
    const wrap = tableWrapRef.current;
    const viewport = wrap?.querySelector<HTMLElement>(".ant-table-tbody-virtual");
    if (!wrap || !viewport) return;
    let columnLeft = indexWidth;
    for (let order = 0; order < visibleIndex; order++) {
      columnLeft += columnWidths[visibleColumns[order]] ?? 0;
    }
    const width = columnWidths[pinnedColumn] ?? 0;
    const offset = bodyOffset();
    const naturalLeft = columnLeft - offset;
    const naturalRight = naturalLeft + width;
    const viewportWidth = viewport.clientWidth;
    const previous = pinHover.current.offset;
    pinHover.current.offset = offset;
    const direction = offset > previous + 0.5 ? 1 : offset < previous - 0.5 ? -1 : 0;

    setPinSide((current) => {
      if (current === "start") {
        // The column has come back far enough that its natural slot is visible again. A single
        // large wheel can cross the whole viewport, so consider the other edge in the same
        // pass instead of waiting for a mutation that may never come.
        if (naturalLeft >= indexWidth + 6) {
          return naturalRight > viewportWidth + 1 ? "end" : null;
        }
        return current;
      }
      if (current === "end") {
        if (naturalRight <= viewportWidth - 6) {
          return naturalLeft < indexWidth - 1 ? "start" : null;
        }
        return current;
      }
      const outLeft = naturalLeft < indexWidth - 1;
      const outRight = naturalRight > viewportWidth + 1;
      if (outLeft && outRight) return direction >= 0 ? "start" : "end";
      if (outLeft) return "start";
      if (outRight) return "end";
      return null;
    });
  }, [bodyOffset, columnWidths, indexWidth, pinnedColumn, tableWrapRef, visibleColumns]);

  useEffect(() => {
    if (pinnedColumn === null) return;
    const wrap = tableWrapRef.current;
    const inner = wrap?.querySelector<HTMLElement>(".ant-table-tbody-virtual-holder-inner");
    if (!wrap || !inner) return;
    const schedule = () => {
      if (pinFrame.current) return;
      pinFrame.current = requestAnimationFrame(() => {
        pinFrame.current = 0;
        updatePinSide();
      });
    };
    pinHover.current.offset = bodyOffset();
    schedule();
    // The body offset is an inline `margin-left`; a programmatic scroll and a scrollbar drag
    // both rewrite it, so one observer covers every way the grid moves horizontally.
    const observer = new MutationObserver(schedule);
    observer.observe(inner, { attributes: true, attributeFilter: ["style"] });
    const resize = new ResizeObserver(schedule);
    resize.observe(wrap);
    return () => {
      observer.disconnect();
      resize.disconnect();
      cancelAnimationFrame(pinFrame.current);
      pinFrame.current = 0;
    };
  }, [bodyOffset, pinnedColumn, tableWrapRef, updatePinSide]);

  const clearPin = useCallback(() => {
    setPinnedColumn(null);
    setPinSide(null);
  }, []);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  useEffect(() => {
    // A wheel turn or a press inside the grid is the reader taking over. The glide is one motion
    // token long, but it must not keep pulling the offset away from a gesture that started
    // during it — a wheel turn is applied in its own animation frame.
    const cancel = (event: Event) => {
      const wrap = tableWrapRef.current;
      const target = event.target;
      if (!wrap || !(target instanceof Node) || !wrap.contains(target)) return;
      // A real gesture is what arms edge pinning; the click's own glide never does.
      pinArmed.current = true;
      stopGlide();
    };
    window.addEventListener("wheel", cancel, { passive: true });
    window.addEventListener("pointerdown", cancel, { passive: true });
    return () => {
      window.removeEventListener("wheel", cancel);
      window.removeEventListener("pointerdown", cancel);
    };
  }, [stopGlide, tableWrapRef]);

  return { activeColumn, setActiveColumn, focusColumn, pinnedColumn, pinSide, clearPin };
}
