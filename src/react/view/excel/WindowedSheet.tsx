import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cellText } from "./sheetView";
import { createSheetWindowReader } from "./sheetWindowReader";
import { visibleRange, type VisibleRange } from "./sheetWindow";
import type { SheetSource } from "./sheetSource";
import { t } from "./excel_i18n";
import "./WindowedSheet.less";

/**
 * Read-only windowed table for large spreadsheets (phase 2 of ADR-0017).
 *
 * The editable grid materialises one object per cell and hands the whole sheet to the editor;
 * for a 20 MB CSV that is seconds of work and hundreds of megabytes. This renders the rows the
 * viewport can see, with spacers standing in for the rest, and reuses `sheetWindow`'s
 * arithmetic + `sheetWindowReader`'s block cache so scrolling does not re-decode the file.
 */

const ROW_HEIGHT = 22;
const INDEX_WIDTH = 56;
const COLUMN_WIDTH = 120;
const OVERSCAN = 4;

export interface WindowedSheetProps {
  source: SheetSource;
  fileName: string;
  onOpenInVSCode: () => void;
}

export default function WindowedSheet({ source, fileName, onOpenInVSCode }: WindowedSheetProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef(0);
  const latestTopRef = useRef(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [rows, setRows] = useState<string[][]>([]);
  const [range, setRange] = useState<VisibleRange | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadSeq = useRef(0);

  const reader = useMemo(() => createSheetWindowReader(source), [source]);
  const columnCount = Math.max(1, source.columnCount);
  const columns = useMemo(
    () => Array.from({ length: columnCount }, (_, index) => index),
    [columnCount],
  );
  const gridTemplate = `${INDEX_WIDTH}px repeat(${columnCount}, ${COLUMN_WIDTH}px)`;

  // The viewport height decides how many rows to ask for; it changes with the panel, not the scroll.
  useEffect(() => {
    const element = scrollerRef.current;
    if (!element) return;
    const measure = () => setViewportHeight(element.clientHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (viewportHeight <= 0) return;
    const viewport = {
      rowHeight: ROW_HEIGHT,
      viewportHeight,
      totalRows: source.rowCount,
      overscan: OVERSCAN,
    };
    const ticket = ++loadSeq.current;
    void reader
      .rowsFor(scrollTop, viewport)
      .then((snapshot) => {
        if (ticket !== loadSeq.current || snapshot.stale) return;
        setRows(snapshot.rows);
        setRange(snapshot.range);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (ticket !== loadSeq.current) return;
        setError(cause instanceof Error ? cause.message : String(cause));
      });
  }, [reader, scrollTop, viewportHeight, source]);

  // One state update per frame: a trackpad emits far more scroll events than there are paints,
  // and every update would otherwise queue another window read.
  const handleScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    latestTopRef.current = event.currentTarget.scrollTop;
    if (frameRef.current) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0;
      setScrollTop(latestTopRef.current);
    });
  }, []);

  useEffect(() => {
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, []);

  const totalHeight = source.rowCount * ROW_HEIGHT;
  const offsetTop = range?.offsetTop ?? 0;
  const offsetBottom = range?.offsetBottom ?? Math.max(0, totalHeight - offsetTop);

  return (
    <div className="windowed-sheet" data-rows={source.rowCount}>
      <div className="windowed-sheet__banner">
        <span>{t("viewer.windowedBanner")}</span>
        <span className="windowed-sheet__meta">
          {source.rowCount.toLocaleString()} × {columnCount.toLocaleString()} · {fileName}
        </span>
        <button type="button" className="windowed-sheet__link" onClick={onOpenInVSCode}>
          {t("viewer.tooLargeOpenInVSCode")}
        </button>
      </div>
      {error && <div className="windowed-sheet__error">{error}</div>}
      <div
        className="windowed-sheet__scroller"
        ref={scrollerRef}
        onScroll={handleScroll}
        tabIndex={0}
        aria-label={fileName}
      >
        <div
          className="windowed-sheet__inner"
          style={{ width: INDEX_WIDTH + columnCount * COLUMN_WIDTH }}
        >
          <div className="windowed-sheet__header" style={{ gridTemplateColumns: gridTemplate }}>
            <span className="windowed-sheet__index">#</span>
            {columns.map((column) => (
              <span key={column} className="windowed-sheet__head">
                {columnName(column)}
              </span>
            ))}
          </div>
          <div className="windowed-sheet__body" style={{ height: totalHeight }}>
            <div style={{ height: offsetTop }} />
            {rows.map((row, offset) => {
              const index = (range?.start ?? 0) + offset;
              return (
                <div
                  key={index}
                  className={`windowed-sheet__row${index % 2 === 1 ? " windowed-sheet__row--alt" : ""}`}
                  style={{ gridTemplateColumns: gridTemplate, height: ROW_HEIGHT }}
                >
                  <span className="windowed-sheet__index">{index + 1}</span>
                  {columns.map((column) => {
                    const text = cellText(row[column]);
                    return (
                      <span key={column} className="windowed-sheet__cell" title={row[column] ?? ""}>
                        {text}
                      </span>
                    );
                  })}
                </div>
              );
            })}
            <div style={{ height: offsetBottom }} />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Spreadsheet column labels: A..Z, AA.. (the grid view shows the same, so the two agree). */
export function columnName(index: number): string {
  let name = "";
  let remaining = index;
  do {
    name = String.fromCharCode(65 + (remaining % 26)) + name;
    remaining = Math.floor(remaining / 26) - 1;
  } while (remaining >= 0);
  return name;
}

// Re-exported so the visible-range math stays testable from the component's tests as well.
export { visibleRange };
