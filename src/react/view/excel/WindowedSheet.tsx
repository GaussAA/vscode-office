import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { highlightRuns } from "../../common/highlight.ts";
import { cellText, headerCells } from "./sheetView";
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
 * The first row is the file's header: it is pulled out of the window and frozen above the
 * body. The body therefore starts at file row 2, while the visible row numbers and the
 * "go to row" input stay 1-based file coordinates.
 */

const ROW_HEIGHT = 22;
const HEADER_HEIGHT = 38;
const INDEX_WIDTH = 56;
const MIN_COLUMN_WIDTH = 140;
const MAX_COLUMN_WIDTH = 420;
const OVERSCAN = 4;
const COPY_FEEDBACK_MS = 1_200;

function clampColumnWidth(width: number): number {
  return Math.max(MIN_COLUMN_WIDTH, Math.min(MAX_COLUMN_WIDTH, Math.round(width)));
}

export interface WindowedSheetProps {
  source: SheetSource;
  fileName: string;
  onOpenInVSCode: () => void;
  /** Workbook sources expose their sheets; the picker appears only when there is a choice. */
  sheetNames?: string[];
  activeSheet?: number;
  onSelectSheet?: (index: number) => void;
  /** The parent's Ctrl+F handler focuses the inline Find instead of the dead grid panel. */
  findInputRef?: RefObject<HTMLInputElement | null>;
}

interface SelectedCell {
  row: number;
  col: number;
  value: string;
}

export default function WindowedSheet({
  source,
  fileName,
  onOpenInVSCode,
  sheetNames,
  activeSheet,
  onSelectSheet,
  findInputRef,
}: WindowedSheetProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef(0);
  const latestTopRef = useRef(0);
  const searchSeq = useRef(0);
  const copyTimerRef = useRef<number | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [rows, setRows] = useState<string[][]>([]);
  const [range, setRange] = useState<VisibleRange | null>(null);
  const [headerLabels, setHeaderLabels] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [searchedQuery, setSearchedQuery] = useState("");
  const [matches, setMatches] = useState<number[]>([]);
  const [searchCapped, setSearchCapped] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchProgress, setSearchProgress] = useState<{ scanned: number; matches: number } | null>(
    null,
  );
  const [targetRow, setTargetRow] = useState<number | null>(null);
  const [jumpValue, setJumpValue] = useState("");
  const [selected, setSelected] = useState<SelectedCell | null>(null);
  const [columnWidths, setColumnWidths] = useState<Record<number, number>>({});
  const resizeRef = useRef<{ column: number; startX: number; startWidth: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const loadSeq = useRef(0);

  const dataRowCount = Math.max(0, source.rowCount - 1);
  const columnCount = Math.max(1, source.columnCount);
  const columns = useMemo(
    () => Array.from({ length: columnCount }, (_, index) => index),
    [columnCount],
  );
  const gridTemplate = `${INDEX_WIDTH}px ${columns
    .map((column) =>
      columnWidths[column] ? `${columnWidths[column]}px` : `minmax(${MIN_COLUMN_WIDTH}px, 1fr)`,
    )
    .join(" ")}`;

  /**
   * The body source is the source with the header row removed. This keeps the window math,
   * search, and jump arithmetic in body coordinates while the UI and aria indices stay in
   * file coordinates.
   */
  const dataSource = useMemo<SheetSource>(
    () => ({
      ...source,
      rowCount: dataRowCount,
      readRows: (start, end) => source.readRows(start + 1, end + 1),
    }),
    [dataRowCount, source],
  );
  const reader = useMemo(() => createSheetWindowReader(dataSource), [dataSource]);

  const bodyViewportHeight = Math.max(0, viewportHeight - HEADER_HEIGHT);
  const viewport = useMemo(
    () => ({
      rowHeight: ROW_HEIGHT,
      viewportHeight: bodyViewportHeight,
      totalRows: dataRowCount,
      overscan: OVERSCAN,
    }),
    [bodyViewportHeight, dataRowCount],
  );
  const bodyScrollTop = Math.max(0, scrollTop - HEADER_HEIGHT);
  const matchSet = useMemo(() => new Set(matches), [matches]);
  const needle = query.trim();
  const isSearchResult = needle !== "" && searchedQuery === needle;

  // Read the file's first row once. It becomes the frozen column header; the body never sees it.
  useEffect(() => {
    let cancelled = false;
    void source
      .readRows(0, 1)
      .then(([first]) => {
        if (!cancelled) setHeaderLabels(headerCells(first ? [first] : [], columnCount));
      })
      .catch(() => {
        if (!cancelled) setHeaderLabels([]);
      });
    return () => {
      cancelled = true;
    };
  }, [columnCount, source]);

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
      .rowsFor(bodyScrollTop, viewport)
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
  }, [reader, bodyScrollTop, viewport, viewportHeight]);

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
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (targetRow === null) return;
    const timer = window.setTimeout(() => setTargetRow(null), 1_600);
    return () => window.clearTimeout(timer);
  }, [targetRow]);

  const copySelected = useCallback(async () => {
    if (!selected) return;
    try {
      await navigator.clipboard.writeText(selected.value);
      setCopied(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
    } catch {
      setError(t("viewer.copyFailed"));
    }
  }, [selected]);

  /** Move the viewport to a body row without changing the data path: the jump is a scroll. */
  const jumpToRow = useCallback(
    (row: number) => {
      const top = HEADER_HEIGHT + scrollTopForRow(row, viewport);
      if (scrollerRef.current) scrollerRef.current.scrollTop = top;
      latestTopRef.current = top;
      setScrollTop(top);
      setTargetRow(row);
    },
    [viewport],
  );

  const ensureRowVisible = useCallback(
    (row: number) => {
      const top = Math.max(0, scrollTop - HEADER_HEIGHT);
      const rowTop = row * ROW_HEIGHT;
      if (rowTop >= top && rowTop + ROW_HEIGHT <= top + bodyViewportHeight) return;
      const desired = rowTop < top ? rowTop : rowTop - bodyViewportHeight + ROW_HEIGHT;
      const maxBody = Math.max(0, dataRowCount * ROW_HEIGHT - bodyViewportHeight);
      const next = HEADER_HEIGHT + Math.min(Math.max(0, desired), maxBody);
      if (scrollerRef.current) scrollerRef.current.scrollTop = next;
      latestTopRef.current = next;
      setScrollTop(next);
    },
    [bodyViewportHeight, dataRowCount, scrollTop],
  );

  const selectCell = useCallback(
    (row: number, col: number) => {
      if (dataRowCount <= 0) return;
      const nextRow = Math.max(0, Math.min(dataRowCount - 1, row));
      const nextCol = Math.max(0, Math.min(columnCount - 1, col));
      const visibleRow = rows[nextRow - (range?.start ?? 0)];
      setSelected({ row: nextRow, col: nextCol, value: visibleRow?.[nextCol] ?? "" });
      if (!visibleRow) {
        void dataSource
          .readRows(nextRow, nextRow + 1)
          .then(([data]) => {
            setSelected((current) =>
              current && current.row === nextRow && current.col === nextCol
                ? { ...current, value: data?.[nextCol] ?? "" }
                : current,
            );
          })
          .catch(() => {});
      }
    },
    [columnCount, dataRowCount, dataSource, range, rows],
  );

  const moveSelection = useCallback(
    (row: number, col: number) => {
      selectCell(row, col);
      ensureRowVisible(Math.max(0, Math.min(dataRowCount - 1, row)));
    },
    [dataRowCount, ensureRowVisible, selectCell],
  );

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

  const runSearch = useCallback(async () => {
    const ticket = ++searchSeq.current;
    setQuery(needle);
    setSearchCapped(false);
    if (!needle) {
      setSearchedQuery("");
      setMatches([]);
      setSearchProgress(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    setSearchProgress({ scanned: 0, matches: 0 });
    try {
      const result = await searchSheetRows(dataSource, needle, {
        isCancelled: () => ticket !== searchSeq.current,
        onProgress: (scanned, found) => {
          if (ticket === searchSeq.current) setSearchProgress({ scanned, matches: found });
        },
      });
      if (ticket !== searchSeq.current || result.cancelled) return;
      setMatches(result.rows);
      setSearchCapped(result.capped);
      setSearchedQuery(needle);
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
  }, [dataSource, jumpToRow, needle]);

  const step = useCallback(
    (direction: 1 | -1) => {
      const current = Math.floor(Math.max(0, scrollTop - HEADER_HEIGHT) / ROW_HEIGHT);
      const target = nextMatch(matches, current, direction);
      if (target !== undefined) jumpToRow(target);
    },
    [jumpToRow, matches, scrollTop],
  );

  const handleJump = useCallback(() => {
    const parsed = Number.parseInt(jumpValue.replace(/,/g, ""), 10);
    if (!Number.isFinite(parsed)) return;
    // The input is 1-based file row; file row 1 is the frozen header, so body row 0 is file row 2.
    const fileRow = Math.max(1, Math.min(source.rowCount, parsed));
    const bodyRow = Math.max(0, Math.min(dataRowCount - 1, fileRow - 2));
    jumpToRow(bodyRow);
  }, [dataRowCount, jumpToRow, jumpValue, source.rowCount]);

  const handleQueryChange = useCallback((value: string) => {
    setQuery(value);
    // A new query invalidates the old hit list; stale highlights are worse than an empty state.
    searchSeq.current++;
    setSearchedQuery("");
    setMatches([]);
    setSearchCapped(false);
    setSearchProgress(null);
    setSearching(false);
    setTargetRow(null);
  }, []);

  const handleFindKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      if (isSearchResult && matches.length > 0) {
        step(event.shiftKey ? -1 : 1);
      } else {
        void runSearch();
      }
    },
    [isSearchResult, matches.length, runSearch, step],
  );

  const handleGridKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (dataRowCount <= 0) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c") {
        if (selected) {
          event.preventDefault();
          void copySelected();
        }
        return;
      }

      const current = selected ?? { row: range?.start ?? 0, col: 0 };
      let row = current.row;
      let col = current.col;
      const page = Math.max(1, Math.floor(bodyViewportHeight / ROW_HEIGHT) - 1);

      switch (event.key) {
        case "ArrowDown":
          row += 1;
          break;
        case "ArrowUp":
          row -= 1;
          break;
        case "ArrowLeft":
          col -= 1;
          break;
        case "ArrowRight":
          col += 1;
          break;
        case "PageDown":
          row += page;
          break;
        case "PageUp":
          row -= page;
          break;
        case "Home":
          if (event.ctrlKey || event.metaKey) {
            row = 0;
            col = 0;
          } else {
            col = 0;
          }
          break;
        case "End":
          if (event.ctrlKey || event.metaKey) {
            row = dataRowCount - 1;
            col = columnCount - 1;
          } else {
            col = columnCount - 1;
          }
          break;
        default:
          return;
      }

      event.preventDefault();
      moveSelection(
        Math.max(0, Math.min(dataRowCount - 1, row)),
        Math.max(0, Math.min(columnCount - 1, col)),
      );
    },
    [bodyViewportHeight, columnCount, copySelected, dataRowCount, moveSelection, range, selected],
  );

  const handleGridFocus = useCallback(() => {
    if (!selected && dataRowCount > 0) selectCell(range?.start ?? 0, 0);
  }, [dataRowCount, range, selectCell, selected]);

  const totalHeight = dataRowCount * ROW_HEIGHT;
  const offsetTop = range?.offsetTop ?? 0;
  const offsetBottom = range?.offsetBottom ?? Math.max(0, totalHeight - offsetTop);
  const countLabel = searching
    ? `${Math.round(((searchProgress?.scanned ?? 0) / Math.max(1, dataRowCount)) * 100)}% · ${searchProgress?.matches ?? 0}`
    : !isSearchResult
      ? ""
      : matches.length === 0
        ? t("findReplace.notFound")
        : matches.length === 1 && !searchCapped
          ? t("viewer.matchesOne", "1")
          : t("viewer.matchesMany", `${matches.length.toLocaleString()}${searchCapped ? "+" : ""}`);
  const selectedValue = selected?.value ?? "";
  const liveStatus = selected
    ? `${columnName(selected.col)}${selected.row + 2}: ${selectedValue}`
    : countLabel;

  return (
    <div className="windowed-sheet" data-rows={source.rowCount} data-columns={columnCount}>
      <div className="windowed-sheet__banner">
        <div className="windowed-sheet__identity">
          <span className="windowed-sheet__mode">{t("viewer.windowedMode")}</span>
          <span className="windowed-sheet__hint">{t("viewer.windowedHint")}</span>
          <span className="windowed-sheet__file">{fileName}</span>
          <span className="windowed-sheet__meta">
            {source.rowCount.toLocaleString()} × {columnCount.toLocaleString()}
          </span>
          {sheetNames && sheetNames.length > 1 && (
            <label className="windowed-sheet__sheet">
              <span>{t("viewer.sheet")}</span>
              <select
                className="windowed-sheet__select"
                value={activeSheet ?? 0}
                onChange={(event) => onSelectSheet?.(Number(event.target.value))}
              >
                {sheetNames.map((name, index) => (
                  <option key={`${name}-${index}`} value={index}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <button type="button" className="windowed-sheet__link" onClick={onOpenInVSCode}>
          {t("viewer.tooLargeOpenInVSCode")}
        </button>
      </div>

      <div
        className="windowed-sheet__scroller"
        ref={scrollerRef}
        onScroll={handleScroll}
        onFocus={handleGridFocus}
        onKeyDown={handleGridKeyDown}
        tabIndex={0}
        role="grid"
        aria-label={fileName}
        aria-readonly="true"
        aria-rowcount={source.rowCount}
        aria-colcount={columnCount + 1}
        aria-activedescendant={
          selected ? `windowed-sheet-cell-${selected.row}-${selected.col}` : undefined
        }
      >
        <div className="windowed-sheet__inner" style={{ width: "max-content", minWidth: "100%" }}>
          <div
            className="windowed-sheet__header"
            role="row"
            aria-rowindex={1}
            style={{ gridTemplateColumns: gridTemplate }}
          >
            <span
              className="windowed-sheet__index windowed-sheet__index--head"
              role="columnheader"
              aria-colindex={1}
            >
              #
            </span>
            {columns.map((column) => (
              <span
                key={column}
                className="windowed-sheet__head"
                role="columnheader"
                aria-colindex={column + 2}
              >
                <span className="windowed-sheet__head-letter">{columnName(column)}</span>
                <span className="windowed-sheet__head-label">
                  {headerLabels[column] || columnName(column)}
                </span>
                <span
                  className="windowed-sheet__resizer"
                  role="separator"
                  aria-orientation="vertical"
                  aria-label={`${t("viewer.resizeColumn")} ${columnName(column)}`}
                  aria-valuemin={MIN_COLUMN_WIDTH}
                  aria-valuemax={MAX_COLUMN_WIDTH}
                  aria-valuenow={columnWidths[column]}
                  tabIndex={0}
                  onPointerDown={(event) => beginResize(column, event)}
                  onPointerMove={moveResize}
                  onPointerUp={endResize}
                  onPointerCancel={endResize}
                  onLostPointerCapture={() => {
                    resizeRef.current = null;
                  }}
                  onDoubleClick={() => resetColumnWidth(column)}
                  onKeyDown={(event) => handleResizeKeyDown(column, event)}
                />
              </span>
            ))}
          </div>
          <div className="windowed-sheet__body" role="rowgroup" style={{ height: totalHeight }}>
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
                  role="row"
                  aria-rowindex={index + 2}
                  style={{ gridTemplateColumns: gridTemplate, height: ROW_HEIGHT }}
                >
                  <span className="windowed-sheet__index" role="rowheader" aria-colindex={1}>
                    {index + 2}
                  </span>
                  {columns.map((column) => {
                    const raw = row[column] ?? "";
                    const text = cellText(raw);
                    const isSelected = selected?.row === index && selected.col === column;
                    return (
                      <span
                        key={column}
                        id={`windowed-sheet-cell-${index}-${column}`}
                        className={`windowed-sheet__cell${isSelected ? " windowed-sheet__cell--selected" : ""}`}
                        role="gridcell"
                        aria-colindex={column + 2}
                        aria-selected={isSelected}
                        onClick={() => {
                          scrollerRef.current?.focus();
                          selectCell(index, column);
                        }}
                      >
                        {needle && isSearchResult ? highlight(text, needle) : text}
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

      {error && <div className="windowed-sheet__error">{error}</div>}

      {selected && (
        <div className="windowed-sheet__selection">
          <span className="windowed-sheet__path">
            {columnName(selected.col)}
            {selected.row + 2}
          </span>
          <span className="windowed-sheet__value">{selectedValue}</span>
          <button
            type="button"
            className="windowed-sheet__copy"
            onClick={() => void copySelected()}
            aria-label={t("button.copy")}
          >
            {copied ? t("viewer.copied") : t("button.copy")}
          </button>
        </div>
      )}

      <div className="windowed-sheet__tools">
        <div className="windowed-sheet__find">
          <input
            ref={findInputRef}
            className="windowed-sheet__input"
            value={query}
            placeholder={t("findReplace.placeholder")}
            aria-label={t("findReplace.title")}
            onChange={(event) => handleQueryChange(event.target.value)}
            onKeyDown={handleFindKeyDown}
          />
          <button type="button" className="windowed-sheet__btn" onClick={() => void runSearch()}>
            {t("findReplace.title")}
          </button>
          <button
            type="button"
            className="windowed-sheet__btn windowed-sheet__btn--icon"
            aria-label={t("findReplace.previous")}
            disabled={!isSearchResult || matches.length === 0}
            onClick={() => step(-1)}
          >
            ↑
          </button>
          <button
            type="button"
            className="windowed-sheet__btn windowed-sheet__btn--icon"
            aria-label={t("findReplace.next")}
            disabled={!isSearchResult || matches.length === 0}
            onClick={() => step(1)}
          >
            ↓
          </button>
          <span className="windowed-sheet__count" aria-hidden="true">
            {countLabel}
          </span>
        </div>
        <span className="windowed-sheet__spacer" />
        <div className="windowed-sheet__jump">
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
      </div>
      <span className="windowed-sheet__sr-only" aria-live="polite" aria-atomic="true">
        {liveStatus}
      </span>
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
