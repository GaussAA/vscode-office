import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { highlightRuns } from "../../common/highlight.ts";
import { cellText } from "./sheetView";
import { nextMatch, searchSheetRows } from "./sheetSearch";
import { createSheetWindowReader } from "./sheetWindowReader";
import { scrollTopForRow, visibleRange, type VisibleRange } from "./sheetWindow";
import type { SheetSource } from "./sheetSource";
import { t } from "./excel_i18n";
import "./WindowedSheet.less";

/**
 * Read-only windowed table for large spreadsheets (phase 2 + 3 of ADR-0017).
 *
 * The editable grid materialises one object per cell and hands the whole sheet to the editor;
 * for a 20 MB CSV that is seconds of work and hundreds of megabytes. This renders the rows the
 * viewport can see, with spacers standing in for the rest, and reuses `sheetWindow`'s
 * arithmetic + `sheetWindowReader`'s block cache so scrolling does not re-decode the file.
 *
 * Find and "go to row" are phase 3: the view has no cell model to walk, so a search reads row
 * blocks from the same source and the jump only moves the scroll offset.
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
  const searchSeq = useRef(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [rows, setRows] = useState<string[][]>([]);
  const [range, setRange] = useState<VisibleRange | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<number[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchProgress, setSearchProgress] = useState<{ scanned: number; matches: number } | null>(
    null,
  );
  const [targetRow, setTargetRow] = useState<number | null>(null);
  const [jumpValue, setJumpValue] = useState("");
  const loadSeq = useRef(0);

  const reader = useMemo(() => createSheetWindowReader(source), [source]);
  const columnCount = Math.max(1, source.columnCount);
  const columns = useMemo(
    () => Array.from({ length: columnCount }, (_, index) => index),
    [columnCount],
  );
  const gridTemplate = `${INDEX_WIDTH}px repeat(${columnCount}, ${COLUMN_WIDTH}px)`;
  const matchSet = useMemo(() => new Set(matches), [matches]);
  const needle = query.trim();

  const viewport = useMemo(
    () => ({
      rowHeight: ROW_HEIGHT,
      viewportHeight,
      totalRows: source.rowCount,
      overscan: OVERSCAN,
    }),
    [viewportHeight, source.rowCount],
  );

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
  }, [reader, scrollTop, viewport, viewportHeight]);

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

  useEffect(() => {
    if (targetRow === null) return;
    const timer = window.setTimeout(() => setTargetRow(null), 1600);
    return () => window.clearTimeout(timer);
  }, [targetRow]);

  /** Move the viewport to a row without changing the data path: the jump is a scroll. */
  const jumpToRow = useCallback(
    (row: number) => {
      const top = scrollTopForRow(row, viewport);
      if (scrollerRef.current) scrollerRef.current.scrollTop = top;
      latestTopRef.current = top;
      setScrollTop(top);
      setTargetRow(row);
    },
    [viewport],
  );

  const runSearch = useCallback(async () => {
    const ticket = ++searchSeq.current;
    setQuery(needle);
    if (!needle) {
      setMatches([]);
      setSearchProgress(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    setSearchProgress({ scanned: 0, matches: 0 });
    try {
      const result = await searchSheetRows(source, needle, {
        isCancelled: () => ticket !== searchSeq.current,
        onProgress: (scanned, found) => {
          if (ticket === searchSeq.current) setSearchProgress({ scanned, matches: found });
        },
      });
      if (ticket !== searchSeq.current || result.cancelled) return;
      setMatches(result.rows);
      if (result.rows.length > 0) jumpToRow(result.rows[0]);
    } catch (cause) {
      if (ticket === searchSeq.current) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      if (ticket === searchSeq.current) {
        setSearching(false);
        setSearchProgress(null);
      }
    }
  }, [jumpToRow, needle, source]);

  const step = useCallback(
    (direction: 1 | -1) => {
      const current = Math.floor(scrollTop / ROW_HEIGHT);
      const target = nextMatch(matches, current, direction);
      if (target !== undefined) jumpToRow(target);
    },
    [jumpToRow, matches, scrollTop],
  );

  const handleJump = useCallback(() => {
    const parsed = Number.parseInt(jumpValue.replace(/,/g, ""), 10);
    if (!Number.isFinite(parsed)) return;
    // The input is 1-based like the index column; the source is 0-based.
    jumpToRow(Math.max(0, Math.min(source.rowCount - 1, parsed - 1)));
  }, [jumpToRow, jumpValue, source.rowCount]);

  const totalHeight = source.rowCount * ROW_HEIGHT;
  const offsetTop = range?.offsetTop ?? 0;
  const offsetBottom = range?.offsetBottom ?? Math.max(0, totalHeight - offsetTop);
  const countLabel = searching
    ? `${Math.round(((searchProgress?.scanned ?? 0) / Math.max(1, source.rowCount)) * 100)}% · ${searchProgress?.matches ?? 0}`
    : needle
      ? matches.length === 0
        ? t("findReplace.notFound")
        : matches.length === 1
          ? t("viewer.matchesOne", "1")
          : t("viewer.matchesMany", matches.length.toLocaleString())
      : "";

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
      <div className="windowed-sheet__tools">
        <input
          className="windowed-sheet__input"
          value={query}
          placeholder={t("findReplace.placeholder")}
          aria-label={t("findReplace.title")}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void runSearch();
          }}
        />
        <button type="button" className="windowed-sheet__btn" onClick={() => void runSearch()}>
          {t("findReplace.title")}
        </button>
        <button
          type="button"
          className="windowed-sheet__btn"
          aria-label={t("findReplace.previous")}
          disabled={matches.length === 0}
          onClick={() => step(-1)}
        >
          ↑
        </button>
        <button
          type="button"
          className="windowed-sheet__btn"
          aria-label={t("findReplace.next")}
          disabled={matches.length === 0}
          onClick={() => step(1)}
        >
          ↓
        </button>
        <span className="windowed-sheet__count">{countLabel}</span>
        <span className="windowed-sheet__spacer" />
        <input
          className="windowed-sheet__input windowed-sheet__input--row"
          value={jumpValue}
          placeholder={t("viewer.goToRow")}
          aria-label={t("viewer.goToRow")}
          onChange={(event) => setJumpValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") handleJump();
          }}
        />
        <button type="button" className="windowed-sheet__btn" onClick={handleJump}>
          {t("viewer.go")}
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
              const classes = ["windowed-sheet__row"];
              if (index % 2 === 1) classes.push("windowed-sheet__row--alt");
              if (matchSet.has(index)) classes.push("windowed-sheet__row--match");
              if (index === targetRow) classes.push("windowed-sheet__row--target");
              return (
                <div
                  key={index}
                  className={classes.join(" ")}
                  style={{ gridTemplateColumns: gridTemplate, height: ROW_HEIGHT }}
                >
                  <span className="windowed-sheet__index">{index + 1}</span>
                  {columns.map((column) => {
                    const text = cellText(row[column]);
                    return (
                      <span key={column} className="windowed-sheet__cell" title={row[column] ?? ""}>
                        {needle ? highlight(text, needle) : text}
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

function highlight(text: string, needle: string) {
  const runs = highlightRuns(text, needle);
  if (runs.length === 1 && !runs[0].hit) return text;
  return runs.map((run, index) =>
    run.hit ? (
      <mark key={index} className="windowed-sheet__hit">
        {run.text}
      </mark>
    ) : (
      run.text
    ),
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

export { visibleRange };
