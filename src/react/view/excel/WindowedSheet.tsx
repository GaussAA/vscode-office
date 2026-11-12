import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from "react";
import { highlightRuns } from "../../common/highlight.ts";
import { cellText } from "./sheetView";
import type { SheetSource } from "./sheetSource";
import { t } from "./excel_i18n";
import { useWindowedRows } from "./useWindowedRows";
import { useWindowedFind } from "./useWindowedFind";
import { useColumnResize } from "./useColumnResize";
import WindowedSheetBanner from "./WindowedSheetBanner";
import WindowedFindBar from "./WindowedFindBar";
import WindowedSelectionBar from "./WindowedSelectionBar";
import {
  COPY_FEEDBACK_MS,
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  ROW_HEIGHT,
  bodyRowToFileRow,
  cellId,
  columnName,
  fileRowToBodyRow,
} from "./windowedSheetModel";
import "./WindowedSheet.less";

/**
 * Read-only windowed table for large spreadsheets (phase 2 + 3 of ADR-0017).
 *
 * The component is deliberately a coordinator: `useWindowedRows` owns the virtual window,
 * `useWindowedFind` owns search, and `useColumnResize` owns the resizer. The three presentation
 * pieces are separate components, so this file only wires them to the sheet's selection and
 * keyboard model.
 *
 * The first row is the file's header: it is pulled out of the window and frozen above the
 * body. The body therefore starts at file row 2, while the visible row numbers and the
 * "go to row" input stay 1-based file coordinates.
 */

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
  const rowsState = useWindowedRows(source);
  const {
    scrollerRef,
    rows,
    range,
    headerLabels,
    error,
    setError,
    dataRowCount,
    columnCount,
    dataSource,
    bodyScrollTop,
    bodyViewportHeight,
    totalHeight,
    handleScroll,
    scrollToRow,
    ensureRowVisible,
  } = rowsState;

  const [targetRow, setTargetRow] = useState<number | null>(null);
  const [jumpValue, setJumpValue] = useState("");
  const [selected, setSelected] = useState<SelectedCell | null>(null);
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<number | null>(null);
  const resize = useColumnResize(columnCount);

  const columns = useMemo(
    () => Array.from({ length: columnCount }, (_, index) => index),
    [columnCount],
  );

  const jumpToRow = useCallback(
    (row: number) => {
      scrollToRow(row);
      setTargetRow(row);
    },
    [scrollToRow],
  );

  const find = useWindowedFind({
    source: dataSource,
    rowCount: dataRowCount,
    bodyScrollTop,
    jumpToRow,
    onError: setError,
  });
  const needle = find.query.trim();
  const matchSet = useMemo(() => new Set(find.matches), [find.matches]);

  useEffect(() => {
    if (targetRow === null) return;
    const timer = window.setTimeout(() => setTargetRow(null), 1_600);
    return () => window.clearTimeout(timer);
  }, [targetRow]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

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
  }, [selected, setError]);

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

  const handleJump = useCallback(() => {
    const parsed = Number.parseInt(jumpValue.replace(/,/g, ""), 10);
    if (!Number.isFinite(parsed)) return;
    const fileRow = Math.max(1, Math.min(source.rowCount, parsed));
    jumpToRow(fileRowToBodyRow(fileRow, source.rowCount));
  }, [jumpValue, jumpToRow, source.rowCount]);

  const changeQuery = find.handleQueryChange;
  const handleQueryChange = useCallback(
    (value: string) => {
      changeQuery(value);
      setTargetRow(null);
    },
    [changeQuery],
  );

  const handleFindKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      if (find.isSearchResult && find.matches.length > 0) {
        find.step(event.shiftKey ? -1 : 1);
      } else {
        void find.runSearch();
      }
    },
    [find],
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

  const offsetTop = range?.offsetTop ?? 0;
  const offsetBottom = range?.offsetBottom ?? Math.max(0, totalHeight - offsetTop);
  const selectedValue = selected?.value ?? "";
  const liveStatus = selected
    ? `${columnName(selected.col)}${bodyRowToFileRow(selected.row)}: ${selectedValue}`
    : find.countLabel;

  return (
    <div className="windowed-sheet" data-rows={source.rowCount} data-columns={columnCount}>
      <WindowedSheetBanner
        fileName={fileName}
        rowCount={source.rowCount}
        columnCount={columnCount}
        sheetNames={sheetNames}
        activeSheet={activeSheet}
        onSelectSheet={onSelectSheet}
        onOpenInVSCode={onOpenInVSCode}
      />

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
        aria-activedescendant={selected ? cellId(selected.row, selected.col) : undefined}
      >
        <div className="windowed-sheet__inner" style={{ width: "max-content", minWidth: "100%" }}>
          <div
            className="windowed-sheet__header"
            role="row"
            aria-rowindex={1}
            style={{ gridTemplateColumns: resize.gridTemplate }}
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
                  aria-valuenow={resize.columnWidths[column]}
                  tabIndex={0}
                  onPointerDown={(event) => resize.beginResize(column, event)}
                  onPointerMove={resize.moveResize}
                  onPointerUp={resize.endResize}
                  onPointerCancel={resize.endResize}
                  onLostPointerCapture={resize.clearResize}
                  onDoubleClick={() => resize.resetColumnWidth(column)}
                  onKeyDown={(event) => resize.handleResizeKeyDown(column, event)}
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
                  aria-rowindex={bodyRowToFileRow(index)}
                  style={{ gridTemplateColumns: resize.gridTemplate, height: ROW_HEIGHT }}
                >
                  <span className="windowed-sheet__index" role="rowheader" aria-colindex={1}>
                    {bodyRowToFileRow(index)}
                  </span>
                  {columns.map((column) => {
                    const raw = row[column] ?? "";
                    const text = cellText(raw);
                    const isSelected = selected?.row === index && selected.col === column;
                    return (
                      <span
                        key={column}
                        id={cellId(index, column)}
                        className={`windowed-sheet__cell${isSelected ? " windowed-sheet__cell--selected" : ""}`}
                        role="gridcell"
                        aria-colindex={column + 2}
                        aria-selected={isSelected}
                        onClick={() => {
                          scrollerRef.current?.focus();
                          selectCell(index, column);
                        }}
                      >
                        {needle && find.isSearchResult ? highlight(text, needle) : text}
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
        <WindowedSelectionBar
          path={`${columnName(selected.col)}${bodyRowToFileRow(selected.row)}`}
          value={selectedValue}
          copied={copied}
          onCopy={() => void copySelected()}
        />
      )}

      <WindowedFindBar
        findInputRef={findInputRef}
        query={find.query}
        countLabel={find.countLabel}
        matches={find.matches.length}
        isSearchResult={find.isSearchResult}
        jumpValue={jumpValue}
        onQueryChange={handleQueryChange}
        onFind={() => void find.runSearch()}
        onFindKeyDown={handleFindKeyDown}
        onPrevious={() => find.step(-1)}
        onNext={() => find.step(1)}
        onJumpValueChange={setJumpValue}
        onJump={handleJump}
      />
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
