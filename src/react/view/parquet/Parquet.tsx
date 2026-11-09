import { App, ConfigProvider, InputNumber, Table, theme as antdTheme } from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import "@vscode/codicons/dist/codicon.css";
import { $t } from "../../i18n/i18nConfig.ts";
import { handler } from "../../util/vscode.ts";
import { getVscodeThemeColor, useVscodeDarkTheme } from "../../util/vscodeTheme.ts";
import { arrayBufferFromPayload } from "../../util/loadOfficeContent.ts";
import { openParquetSource } from "../../util/parquetSource.ts";
import { highlightRuns } from "../../common/highlight.ts";
import { savePersistedState } from "../../common/persistedState.ts";
import { ParquetSession } from "./parquetSession.ts";
import SponsorBar from "../components/SponsorBar.tsx";
import {
  formatCellValue,
  PARQUET_PAGE_SIZE,
  openParquetFile,
  readParquetRows,
  type ColumnCategory,
  type ParquetColumnInfo,
  type ParquetFileInfo,
} from "./parquetParser.ts";
import "./Parquet.less";

const PAGE_SIZE = PARQUET_PAGE_SIZE;
/** Rows read per batch while searching the whole file. */
const SEARCH_BATCH = 5_000;
/** Cap on matched rows kept in memory (highlight + navigation). */
const SEARCH_MAX_ROWS = 5_000;
/** Schema sidebar bounds; the drag handle and keyboard use the same range. */
const SIDER_MIN = 208;
const SIDER_MAX = 420;
const SIDER_DEFAULT = 260;
const SIDER_STORAGE_KEY = "parquet-sider-width";

/** Wrap the matched runs of a cell value in <mark>, so a hit is visible in place. */
function highlightCell(text: string, needle: string) {
  if (!needle) return text;
  const parts: React.ReactNode[] = [];
  highlightRuns(text, needle).forEach((run, position) => {
    if (!run.hit) {
      parts.push(run.text);
      return;
    }
    parts.push(
      <mark key={position} className="parquet-viewer__hit">
        {run.text}
      </mark>,
    );
  });
  return parts;
}
/** Icon per category. The category itself is decided once, in parquetParser.categorizeType. */
const COLUMN_ICONS: Record<ColumnCategory, string> = {
  bool: "codicon-symbol-boolean",
  numeric: "codicon-symbol-numeric",
  string: "codicon-symbol-string",
  datetime: "codicon-symbol-event",
  structure: "codicon-symbol-structure",
  field: "codicon-symbol-field",
};

type TableRow = Record<string, unknown> & { key: string };

/** Keyboard cursor into the visible page: row is page-local, col indexes fileInfo.columns. */
interface CellCursor {
  row: number;
  col: number;
}

const CursorContext = createContext<CellCursor | null>(null);

/**
 * One data cell. It reads the cursor from context instead of receiving it through the
 * memoised column definitions, so moving the cursor re-renders the cells without
 * rebuilding every column definition.
 *
 * The cell is a roving tab stop: only the cursor cell has `tabIndex=0`. Arrow keys move
 * real focus here, and the aria-label gives screen readers the column, row and value.
 */
function ParquetCell({
  value,
  rowIndex,
  pageIndex,
  position,
  column,
  query,
  onActivate,
}: {
  value: unknown;
  rowIndex: number;
  pageIndex: number;
  position: number;
  column: ParquetColumnInfo;
  query: string;
  onActivate: () => void;
}) {
  const cursor = useContext(CursorContext);
  const isCursor = cursor?.row === pageIndex && cursor?.col === position;
  const kind = column.category;
  const isNull = value === null || value === undefined;
  const displayText = isNull ? $t("parquet.nullLabel") : formatCellValue(value);
  const classes = [
    "parquet-viewer__cell",
    isNull ? "parquet-viewer__cell--null" : kind === "bool" ? "" : `parquet-viewer__cell--${kind}`,
    kind === "bool" && !isNull
      ? value === true
        ? "parquet-viewer__cell--bool-true"
        : "parquet-viewer__cell--bool-false"
      : "",
    isCursor ? "parquet-viewer__cell--cursor" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const labelText = displayText.length > 160 ? `${displayText.slice(0, 160)}…` : displayText;

  return (
    <span
      className={classes}
      data-cell={`${pageIndex}:${position}`}
      tabIndex={isCursor ? 0 : -1}
      aria-label={`${column.name}, row ${rowIndex + 1}: ${labelText}`}
      title={isNull ? "null" : displayText}
      onClick={onActivate}
    >
      {isNull ? $t("parquet.nullLabel") : highlightCell(displayText, query.trim())}
    </span>
  );
}

/**
 * Where this document was left when its webview went away.
 *
 * Persisted per document, in `localStorage`, keyed by the document's path: webviews of one
 * view type share a single origin, so an unkeyed entry would be overwritten by whichever
 * parquet file was open last. The JSONL viewer does the same thing with its `cacheId`.
 *
 * This exists so the viewer comes back where the user left it once the webview is allowed
 * to be destroyed when its tab is hidden (see `retainContextWhenHidden`).
 */
const PERSIST_PREFIX = "parquet-state:";

function loadPersistedPage(key: string | undefined): number {
  if (!key) return 0;
  try {
    const raw = localStorage.getItem(PERSIST_PREFIX + key);
    if (!raw) return 0;
    const parsed = JSON.parse(raw) as { page?: number };
    return typeof parsed.page === "number" && parsed.page >= 0 ? parsed.page : 0;
  } catch {
    return 0;
  }
}

function savePersistedPage(key: string | undefined, page: number) {
  if (!key) return;
  savePersistedState(PERSIST_PREFIX, key, { page });
}

function ParquetViewer() {
  const { message } = App.useApp();
  const [fileInfo, setFileInfo] = useState<ParquetFileInfo | null>(null);
  const [pageRows, setPageRows] = useState<Record<string, unknown>[]>([]);
  const [pageLoading, setPageLoading] = useState(false);
  const [rowJump, setRowJump] = useState<number | null>(null);
  const [inspected, setInspected] = useState<{
    row: number;
    column: string;
    value: unknown;
  } | null>(null);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchProgress, setSearchProgress] = useState<{
    scanned: number;
    total: number;
    matches: number;
  } | null>(null);
  const [matchRows, setMatchRows] = useState<Set<number>>(() => new Set());
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Keyboard cursor into the grid; null until an arrow key (or a click) lands somewhere. */
  const [cursor, setCursor] = useState<CellCursor | null>(null);
  const [siderWidth, setSiderWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(SIDER_STORAGE_KEY));
      if (Number.isFinite(saved) && saved >= SIDER_MIN && saved <= SIDER_MAX) return saved;
    } catch {}
    return SIDER_DEFAULT;
  });
  const [tableBodyHeight, setTableBodyHeight] = useState(320);
  const tableWrapRef = useRef<HTMLDivElement | null>(null);
  const cursorRef = useRef<CellCursor | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const siderDragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  /** Absolute row the footer jump aimed at, highlighted until the next navigation. */
  const [targetRow, setTargetRow] = useState<number | null>(null);
  /** True when the whole-file search stopped at SEARCH_MAX_ROWS instead of finishing. */
  const [searchCapped, setSearchCapped] = useState(false);
  const fileInfoRef = useRef<ParquetFileInfo | null>(null);
  /** localStorage key of the open document; empty for inline (virtual) buffers. */
  const documentKeyRef = useRef<string | undefined>(undefined);
  /** Owns the page cache, cancellation and the page<->row arithmetic. */
  const sessionRef = useRef<ParquetSession | null>(null);
  const searchSeq = useRef(0);

  // Keep the cursor in a ref as well as state: several keydowns can arrive before React
  // re-renders, and each one must move from the position the previous one reached.
  const selectCell = useCallback((next: CellCursor | null) => {
    cursorRef.current = next;
    setCursor(next);
  }, []);

  const totalPages = useMemo(() => {
    if (!fileInfo?.rowCount) return 1;
    return Math.max(1, Math.ceil(fileInfo.rowCount / PAGE_SIZE));
  }, [fileInfo?.rowCount]);

  const tableRows = useMemo<TableRow[]>(() => {
    return pageRows.map((row, index) => ({
      ...row,
      key: `${page}-${index}`,
    }));
  }, [pageRows, page]);

  const loadParquet = useCallback(
    async (payload: { path?: string; buffer?: number[] }) => {
      setLoading(true);
      setError(null);
      setFileInfo(null);
      fileInfoRef.current = null;
      sessionRef.current?.reset();
      sessionRef.current = null;
      setPageRows([]);
      setInspected(null);
      selectCell(null);
      setTargetRow(null);
      searchSeq.current++;
      setSearching(false);
      setSearchProgress(null);
      setSearchCapped(false);
      setMatchRows(new Set());
      setQuery("");
      // Clear the key before resetting the page, otherwise the reset would be persisted
      // against the document we are leaving.
      documentKeyRef.current = undefined;
      setPage(0);
      try {
        // Files arrive either as an inline byte array (virtual documents) or as a
        // fetchable URI. For URIs we probe Range support so hyparquet pulls only the
        // footer and the pages it needs, instead of the whole file.
        const info = payload.buffer?.length
          ? await openParquetFile(arrayBufferFromPayload(payload))
          : await openParquetFile((await openParquetSource(payload.path ?? "")).file);
        fileInfoRef.current = info;
        setFileInfo(info);
        // Come back to the page this document was left on, clamped: the file may have
        // shrunk since. Only file-backed documents have a stable key.
        documentKeyRef.current = payload.path;
        const lastPage = Math.max(0, Math.ceil(info.rowCount / PAGE_SIZE) - 1);
        setPage(Math.min(loadPersistedPage(payload.path), lastPage));

        sessionRef.current = new ParquetSession(
          {
            rowCount: info.rowCount,
            readRows: (start, end) => readParquetRows(info.file, info.metadata, start, end),
          },
          { pageSize: PAGE_SIZE },
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load parquet file");
      } finally {
        setLoading(false);
      }
    },
    [selectCell],
  );

  // Rows are read one page at a time; a big file no longer materialises every row in the
  // webview. The session owns the cache, the prefetch and the "only the newest page wins"
  // guard, so this effect is only wiring.
  useEffect(() => {
    const session = sessionRef.current;
    if (!session) return;
    setPageLoading(true);
    // Aborted from the cleanup rather than flipping a captured `let`: the session already
    // guards staleness, this only stops a superseded page from writing state.
    const controller = new AbortController();
    void session
      .showPage(page)
      .then((snapshot) => {
        if (controller.signal.aborted || snapshot.stale) return;
        setPageRows(snapshot.rows);
        setPageLoading(false);
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        setPageLoading(false);
        setError(e instanceof Error ? e.message : "Failed to read rows");
      });
    session.prefetch(page + 1);
    return () => {
      controller.abort();
    };
  }, [fileInfo, page]);

  // Every page change drops the inspector, the cursor and the jump highlight: they all
  // point at rows on the old page. `jumpToRow` re-sets the highlight right after this.
  const goToPage = useCallback(
    (next: number | ((current: number) => number)) => {
      setInspected(null);
      selectCell(null);
      setTargetRow(null);
      setPage(next);
    },
    [selectCell],
  );

  useEffect(() => {
    savePersistedPage(documentKeyRef.current, page);
  }, [page, fileInfo]);

  useEffect(() => {
    try {
      localStorage.setItem(SIDER_STORAGE_KEY, String(siderWidth));
    } catch {}
  }, [siderWidth]);

  // The table body gets the height the flex column actually leaves it, instead of a
  // `100vh - N` guess that turns into an unexplained gap whenever the bars change.
  useEffect(() => {
    const element = tableWrapRef.current;
    if (!element || !fileInfo) return;
    const update = () => {
      const header = element.querySelector<HTMLElement>(".ant-table-header");
      const headerHeight = header?.offsetHeight ?? 38;
      setTableBodyHeight(Math.max(80, Math.round(element.clientHeight - headerHeight)));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [fileInfo, siderWidth]);

  useEffect(() => {
    const onFind = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "f") return;
      event.preventDefault();
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    };
    window.addEventListener("keydown", onFind);
    return () => window.removeEventListener("keydown", onFind);
  }, []);

  const clampSiderWidth = (width: number) =>
    Math.min(SIDER_MAX, Math.max(SIDER_MIN, Math.round(width)));

  const handleSiderPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    siderDragRef.current = { startX: event.clientX, startWidth: siderWidth };
    event.currentTarget.setPointerCapture(event.pointerId);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  const handleSiderPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = siderDragRef.current;
    if (!drag) return;
    setSiderWidth(clampSiderWidth(drag.startWidth + event.clientX - drag.startX));
  };

  const handleSiderPointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    siderDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    document.body.style.removeProperty("cursor");
    document.body.style.removeProperty("user-select");
  };

  const jumpToRow = useCallback(
    (warnWhenEmpty = true) => {
      const info = fileInfoRef.current;
      if (!info) return;
      // Fail loud on an explicit Enter/Go; a blur with an empty box is just a no-op.
      if (rowJump == null) {
        if (warnWhenEmpty) message.warning($t("parquet.invalidRow"));
        return;
      }
      const row = Math.max(0, Math.min(info.rowCount - 1, Math.round(rowJump) - 1));
      goToPage(Math.floor(row / PAGE_SIZE));
      setTargetRow(row);
    },
    [rowJump, goToPage, message],
  );

  // Bring the jumped-to row into view once its page has rendered; without this the right
  // page loads but the target row can sit below the fold and the user hunts for it.
  useEffect(() => {
    if (targetRow == null) return;
    document.querySelector(".parquet-viewer__row--target")?.scrollIntoView({ block: "center" });
  }, [targetRow, pageRows]);

  const rowRange = useMemo(() => {
    if (!fileInfo) return "";
    const start = page * PAGE_SIZE + 1;
    const end = Math.min(fileInfo.rowCount, (page + 1) * PAGE_SIZE);
    return `${start.toLocaleString()}–${end.toLocaleString()} of ${fileInfo.rowCount.toLocaleString()}`;
  }, [fileInfo, page]);

  const runSearch = useCallback(async () => {
    const info = fileInfoRef.current;
    const session = sessionRef.current;
    const needle = query.trim().toLowerCase();
    const seq = ++searchSeq.current;
    setMatchRows(new Set());
    setSearchCapped(false);
    if (!info || !session || !needle) {
      setSearching(false);
      setSearchProgress(null);
      return;
    }
    setSearching(true);
    setSearchProgress({ scanned: 0, total: info.rowCount, matches: 0 });
    const found = new Set<number>();
    try {
      // Batch by batch, so a 250k-row file never lands in memory at once and the
      // scan can be cancelled by a newer query. Reading through the session means the
      // scan sees edited cells, exactly like the table does.
      for (let start = 0; start < info.rowCount; start += SEARCH_BATCH) {
        if (seq !== searchSeq.current) return;
        const end = Math.min(info.rowCount, start + SEARCH_BATCH);
        const rows = await session.readRange(start, end);
        for (let offset = 0; offset < rows.length; offset++) {
          const row = rows[offset];
          const hit = info.columns.some((column) =>
            formatCellValue(row[column.name]).toLowerCase().includes(needle),
          );
          if (hit) found.add(start + offset);
        }
        setSearchProgress({ scanned: end, total: info.rowCount, matches: found.size });
        if (found.size >= SEARCH_MAX_ROWS) {
          // JSONL shows the same kind of suffix; stopping silently would read as "that
          // was every match" when it was only the first 5,000.
          setSearchCapped(true);
          break;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      }
      if (seq !== searchSeq.current) return;
      setMatchRows(found);
      if (found.size > 0) {
        const first = found.values().next().value as number;
        const target = Math.floor(first / PAGE_SIZE);
        goToPage((current) => (current === target ? current : target));
      }
    } catch (e) {
      if (seq === searchSeq.current) setError(e instanceof Error ? e.message : "Search failed");
    } finally {
      if (seq === searchSeq.current) setSearching(false);
    }
  }, [query, goToPage]);

  const jumpMatch = useCallback(
    (direction: 1 | -1) => {
      if (matchRows.size === 0) return;
      const sorted = [...matchRows].sort((a, b) => a - b);
      const pageStart = page * PAGE_SIZE;
      const pageEnd = pageStart + PAGE_SIZE;
      const target =
        direction > 0
          ? (sorted.find((row) => row >= pageEnd) ?? sorted[0])
          : ([...sorted].reverse().find((row) => row < pageStart) ?? sorted[sorted.length - 1]);
      goToPage(Math.floor(target / PAGE_SIZE));
    },
    [matchRows, page, goToPage],
  );

  // clearing the box drops the previous results
  const resetSearch = useCallback(() => {
    searchSeq.current++;
    setSearching(false);
    setSearchProgress(null);
    setSearchCapped(false);
    setMatchRows(new Set());
  }, []);

  const handleQueryChange = useCallback(
    (next: string) => {
      setQuery(next);
      if (!next.trim()) resetSearch();
    },
    [resetSearch],
  );
  /**
   * Grid keyboard cursor: arrows move, Home/End jump to first/last column, Enter inspects,
   * Escape dismisses. The cells themselves are spans, so without this the table is
   * mouse-only — the JSONL viewer ships a full keyboard model and the grid should too.
   */
  const handleTableKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (!fileInfo) return;
      const target = event.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) {
        return;
      }
      if (event.key === "Escape") {
        selectCell(null);
        setInspected(null);
        tableWrapRef.current?.focus();
        return;
      }
      const column = cursor ? fileInfo.columns[cursor.col] : undefined;
      const row = cursor ? pageRows[cursor.row] : undefined;
      if (event.key === "Enter") {
        if (cursor && row && column) {
          setInspected({
            row: page * PAGE_SIZE + cursor.row,
            column: column.name,
            value: row[column.name],
          });
        }
        return;
      }
      const rows = Math.max(1, pageRows.length);
      const cols = fileInfo.columns.length;
      const moves: Record<string, [number, number]> = {
        ArrowDown: [1, 0],
        ArrowUp: [-1, 0],
        ArrowRight: [0, 1],
        ArrowLeft: [0, -1],
        Home: [0, -Infinity],
        End: [0, Infinity],
      };
      const move = moves[event.key];
      if (!move) return;
      event.preventDefault();
      const base = cursorRef.current ?? { row: 0, col: 0 };
      const next = {
        row: Math.max(0, Math.min(rows - 1, base.row + move[0])),
        col:
          move[1] === -Infinity
            ? 0
            : move[1] === Infinity
              ? cols - 1
              : Math.max(0, Math.min(cols - 1, base.col + move[1])),
      };
      selectCell(next);
      const nextColumn = fileInfo.columns[next.col];
      const nextRow = pageRows[next.row];
      if (nextColumn && nextRow) {
        setInspected({
          row: page * PAGE_SIZE + next.row,
          column: nextColumn.name,
          value: nextRow[nextColumn.name],
        });
      }
    },
    [cursor, fileInfo, page, pageRows, selectCell],
  );

  // Move real focus with the cursor. A focusable cell is what makes the roving tabindex
  // work for assistive tech; the scroll keeps the focused cell in view.
  useEffect(() => {
    if (!cursor) return;
    const cell = tableWrapRef.current?.querySelector<HTMLElement>(
      `[data-cell="${cursor.row}:${cursor.col}"]`,
    );
    cell?.focus({ preventScroll: true });
    cell?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [cursor, pageRows]);

  const tableColumns = useMemo<ColumnsType<TableRow>>(() => {
    if (!fileInfo) return [];
    const cols: ColumnsType<TableRow> = [
      {
        title: "#",
        key: "__index",
        width: 64,
        align: "center",
        fixed: "left",
        className: "parquet-viewer__index-cell",
        render: (_value, _row, index) => page * PAGE_SIZE + index + 1,
      },
    ];
    fileInfo.columns.forEach((column, position) => {
      const kind = column.category;
      cols.push({
        title: column.name,
        dataIndex: column.name,
        key: column.name,
        ellipsis: true,
        minWidth: 120,
        align: kind === "numeric" ? "right" : "left",
        render: (value: unknown, _row, index) => {
          const rowIndex = page * PAGE_SIZE + index;
          return (
            <ParquetCell
              value={value}
              rowIndex={rowIndex}
              pageIndex={index}
              position={position}
              column={column}
              query={query}
              onActivate={() => {
                selectCell({ row: index, col: position });
                setInspected({ row: rowIndex, column: column.name, value });
              }}
            />
          );
        },
      });
    });
    return cols;
  }, [fileInfo, page, query, selectCell]);

  useEffect(() => {
    handler
      .on("open", (payload) => {
        void loadParquet(payload);
      })
      .emit("init");
  }, [loadParquet]);

  const inspectedText = inspected
    ? inspected.value === null || inspected.value === undefined
      ? $t("parquet.nullLabel")
      : typeof inspected.value === "string"
        ? inspected.value
        : formatCellValue(inspected.value)
    : "";

  return (
    <div className="parquet-viewer">
      {loading && (
        <div className="parquet-viewer__overlay">
          <span className="codicon codicon-loading codicon-modifier-spin" />
          <span>{$t("parquet.loading")}</span>
        </div>
      )}
      {error ? (
        <div className="parquet-viewer__empty">
          <div className="parquet-viewer__error">
            <span className="codicon codicon-error" />
            <span>{error}</span>
          </div>
        </div>
      ) : fileInfo ? (
        <>
          <header className="parquet-viewer__topbar">
            <div className="parquet-viewer__search">
              <span className="codicon codicon-search parquet-viewer__search-icon" />
              <input
                ref={searchInputRef}
                className="parquet-viewer__find-input"
                placeholder={$t("parquet.findInFile")}
                aria-label={$t("parquet.findInFile")}
                value={query}
                onChange={(event) => handleQueryChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void runSearch();
                }}
              />
              {query && (
                <button
                  type="button"
                  className="parquet-viewer__find-clear"
                  onClick={() => {
                    handleQueryChange("");
                    searchInputRef.current?.focus();
                  }}
                  title={$t("common.close")}
                  aria-label={$t("common.close")}
                >
                  <span className="codicon codicon-close" />
                </button>
              )}
              <button
                type="button"
                className="parquet-viewer__find-btn"
                onClick={() => void runSearch()}
                disabled={searching}
                title={$t("parquet.searchAllRows")}
                aria-label={$t("parquet.searchAllRows")}
              >
                <span
                  className={`codicon ${searching ? "codicon-loading codicon-modifier-spin" : "codicon-arrow-right"}`}
                />
              </button>
            </div>
            <div className="parquet-viewer__find-state">
              {searching && searchProgress && (
                <span className="parquet-viewer__find-count">
                  {Math.round((searchProgress.scanned / Math.max(1, searchProgress.total)) * 100)}%
                  {" · "}
                  {searchProgress.matches}
                </span>
              )}
              {!searching && matchRows.size > 0 && (
                <>
                  <span className="parquet-viewer__find-count">
                    {matchRows.size === 1
                      ? $t("parquet.matchCountOne", { count: "1" })
                      : $t("parquet.matchCountMany", {
                          count: matchRows.size.toLocaleString(),
                        })}
                    {searchCapped
                      ? $t("parquet.cappedSuffix", {
                          max: SEARCH_MAX_ROWS.toLocaleString(),
                        })
                      : ""}
                  </span>
                  <button
                    type="button"
                    className="parquet-viewer__find-btn"
                    onClick={() => jumpMatch(-1)}
                    title={$t("parquet.previousMatch")}
                    aria-label={$t("parquet.previousMatch")}
                  >
                    <span className="codicon codicon-chevron-up" />
                  </button>
                  <button
                    type="button"
                    className="parquet-viewer__find-btn"
                    onClick={() => jumpMatch(1)}
                    title={$t("parquet.nextMatch")}
                    aria-label={$t("parquet.nextMatch")}
                  >
                    <span className="codicon codicon-chevron-down" />
                  </button>
                </>
              )}
            </div>
            <div className="parquet-viewer__meta">
              <span className="parquet-viewer__meta-item" title={$t("parquet.rows")}>
                <span className="codicon codicon-list-flat parquet-icon parquet-icon--rows" />
                <span className="parquet-viewer__meta-value">
                  {fileInfo.rowCount.toLocaleString()}
                </span>
                <span className="parquet-viewer__meta-label">{$t("parquet.rows")}</span>
              </span>
              <span className="parquet-viewer__meta-item" title={$t("parquet.columnsLabel")}>
                <span className="codicon codicon-symbol-field parquet-icon parquet-icon--columns" />
                <span className="parquet-viewer__meta-value">{fileInfo.columns.length}</span>
                <span className="parquet-viewer__meta-label">{$t("parquet.columnsLabel")}</span>
              </span>
              {fileInfo.createdBy && (
                <span
                  className="parquet-viewer__meta-item parquet-viewer__meta-item--author"
                  title={fileInfo.createdBy}
                >
                  <span className="codicon codicon-account parquet-icon parquet-icon--author" />
                  <span className="parquet-viewer__meta-value">
                    {fileInfo.createdBy.length > 40
                      ? `${fileInfo.createdBy.slice(0, 40)}…`
                      : fileInfo.createdBy}
                  </span>
                </span>
              )}
            </div>
          </header>
          <div className="parquet-viewer__body">
            <aside className="parquet-viewer__sider" style={{ width: siderWidth }}>
              <div className="parquet-viewer__sider-heading">
                <span className="parquet-viewer__sider-title">
                  <span className="codicon codicon-symbol-structure parquet-icon parquet-icon--schema" />
                  {$t("parquet.schema")}
                </span>
                <span className="parquet-viewer__sider-count">{fileInfo.columns.length}</span>
              </div>
              <div className="parquet-viewer__list">
                {fileInfo.columns.map((column) => {
                  const icon = COLUMN_ICONS[column.category];
                  const kind = column.category;
                  return (
                    <div key={column.name} className="parquet-viewer__list-item">
                      <span
                        className={`codicon parquet-viewer__list-icon parquet-viewer__list-icon--${kind} ${icon}`}
                      />
                      <span className="parquet-viewer__list-name" title={column.name}>
                        {column.name}
                      </span>
                      <span className="parquet-viewer__list-type" title={column.type}>
                        {column.type}
                      </span>
                    </div>
                  );
                })}
              </div>
            </aside>
            <div
              className="parquet-viewer__resizer"
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize schema sidebar"
              aria-valuemin={SIDER_MIN}
              aria-valuemax={SIDER_MAX}
              aria-valuenow={siderWidth}
              tabIndex={0}
              onPointerDown={handleSiderPointerDown}
              onPointerMove={handleSiderPointerMove}
              onPointerUp={handleSiderPointerEnd}
              onPointerCancel={handleSiderPointerEnd}
              onDoubleClick={() => setSiderWidth(SIDER_DEFAULT)}
              onKeyDown={(event) => {
                if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                  event.preventDefault();
                  const delta = event.key === "ArrowRight" ? 16 : -16;
                  setSiderWidth((width) => clampSiderWidth(width + delta));
                } else if (event.key === "Home") {
                  event.preventDefault();
                  setSiderWidth(SIDER_MIN);
                } else if (event.key === "End") {
                  event.preventDefault();
                  setSiderWidth(SIDER_MAX);
                }
              }}
            />
            <main className="parquet-viewer__main">
              <div
                className="parquet-viewer__table-wrap"
                ref={tableWrapRef}
                tabIndex={cursor ? -1 : 0}
                onKeyDown={handleTableKeyDown}
              >
                <CursorContext.Provider value={cursor}>
                  <Table<TableRow>
                    className="parquet-table"
                    dataSource={tableRows}
                    columns={tableColumns}
                    pagination={false}
                    size="small"
                    scroll={{ y: tableBodyHeight, x: "max-content" }}
                    rowClassName={(_row, index) => {
                      const absolute = page * PAGE_SIZE + index;
                      const classes: string[] = [];
                      if (index % 2 === 1) classes.push("parquet-viewer__row--alt");
                      if (matchRows.has(absolute)) classes.push("parquet-viewer__row--match");
                      if (targetRow === absolute) classes.push("parquet-viewer__row--target");
                      return classes.join(" ");
                    }}
                  />
                </CursorContext.Provider>
              </div>
            </main>
          </div>
          <footer className="parquet-viewer__bottombar">
            <div className="parquet-viewer__selection" aria-live="polite">
              {inspected ? (
                <>
                  <span className="parquet-viewer__selection-label">
                    {inspected.column} · row {inspected.row + 1}
                  </span>
                  <span className="parquet-viewer__selection-value" title={inspectedText}>
                    {inspectedText}
                  </span>
                  <button
                    type="button"
                    className="parquet-viewer__pager-btn"
                    onClick={() => {
                      const text =
                        inspected.value === null || inspected.value === undefined
                          ? "null"
                          : typeof inspected.value === "string"
                            ? inspected.value
                            : JSON.stringify(inspected.value);
                      void navigator.clipboard.writeText(text).catch(() => undefined);
                    }}
                    title={$t("parquet.copyValue")}
                    aria-label={$t("parquet.copyValue")}
                  >
                    <span className="codicon codicon-copy" />
                  </button>
                  <button
                    type="button"
                    className="parquet-viewer__pager-btn"
                    onClick={() => {
                      setInspected(null);
                      tableWrapRef.current?.focus();
                    }}
                    title={$t("common.close")}
                    aria-label={$t("common.close")}
                  >
                    <span className="codicon codicon-close" />
                  </button>
                </>
              ) : (
                <span className="parquet-viewer__selection-hint">{$t("parquet.inspectHint")}</span>
              )}
            </div>
            <div className="parquet-viewer__pager">
              {pageLoading && (
                <span
                  className="codicon codicon-loading codicon-modifier-spin parquet-viewer__pager-loading"
                  aria-label={$t("parquet.loading")}
                />
              )}
              <button
                type="button"
                className="parquet-viewer__pager-btn"
                disabled={page <= 0}
                onClick={() => goToPage((p) => Math.max(0, p - 1))}
                title={$t("parquet.previousPage")}
                aria-label={$t("parquet.previousPage")}
              >
                <span className="codicon codicon-chevron-left" />
              </button>
              <InputNumber
                size="small"
                className="parquet-viewer__row-jump"
                min={1}
                max={fileInfo.rowCount}
                precision={0}
                value={rowJump}
                placeholder={$t("parquet.rowLabel")}
                aria-label={$t("parquet.rowLabel")}
                onChange={(value) => setRowJump(typeof value === "number" ? value : null)}
                onPressEnter={() => jumpToRow()}
                onBlur={(event) => {
                  const next = event.relatedTarget;
                  // The Go button below handles the click itself; do not jump twice.
                  if (next instanceof HTMLElement && next.closest("[data-row-jump-go]")) return;
                  if (rowJump != null) jumpToRow(false);
                }}
              />
              <button
                type="button"
                className="parquet-viewer__pager-btn parquet-viewer__pager-btn--text"
                data-row-jump-go
                onClick={() => jumpToRow()}
                title={$t("parquet.goToRow")}
              >
                {$t("parquet.go")}
              </button>
              <span className="parquet-viewer__pager-info">{rowRange}</span>
              <button
                type="button"
                className="parquet-viewer__pager-btn"
                disabled={page >= totalPages - 1}
                onClick={() => goToPage((p) => Math.min(totalPages - 1, p + 1))}
                title={$t("parquet.nextPage")}
                aria-label={$t("parquet.nextPage")}
              >
                <span className="codicon codicon-chevron-right" />
              </button>
            </div>
          </footer>
        </>
      ) : null}
      <div className="parquet-viewer__corner-actions">
        {!loading && <SponsorBar placement="left" />}
      </div>
    </div>
  );
}

/** antd tokens derived from the same VS Code variables the stylesheet uses. */
function parquetAntdTheme(dark: boolean) {
  return {
    algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    token: {
      // A transparent container renders antd inputs as borders floating on the
      // toolbar; the table is flattened to the page in the stylesheet instead.
      colorBgContainer: getVscodeThemeColor(
        "--vscode-editor-background",
        dark ? "#1e1e1e" : "#ffffff",
      ),
      colorBgElevated: getVscodeThemeColor(
        "--vscode-editorWidget-background",
        dark ? "#202020" : "#ffffff",
      ),
      colorBorder: getVscodeThemeColor("--vscode-panel-border", dark ? "#2b2b2b" : "#e5e5e5"),
      colorText: getVscodeThemeColor("--vscode-foreground", dark ? "#cccccc" : "#3b3b3b"),
      colorTextSecondary: getVscodeThemeColor(
        "--vscode-descriptionForeground",
        dark ? "#9d9d9d" : "#717171",
      ),
      colorPrimary: getVscodeThemeColor("--vscode-button-background", "#0078d4"),
      colorError: getVscodeThemeColor("--vscode-errorForeground", "#f14c4c"),
      colorWarning: getVscodeThemeColor("--vscode-editorWarning-foreground", "#cca700"),
      colorFillAlter: getVscodeThemeColor(
        "--vscode-editorGroupHeader-tabsBackground",
        dark ? "#2d2d2d" : "#f3f4f6",
      ),
      fontFamily: getVscodeThemeColor(
        "--vscode-font-family",
        '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      ),
      fontSize: Number.parseInt(getVscodeThemeColor("--vscode-font-size", "13px"), 10) || 13,
      controlHeightSM: 22,
      borderRadius: 4,
    },
  };
}

export default function Parquet() {
  const dark = useVscodeDarkTheme();
  const antTheme = useMemo(() => parquetAntdTheme(dark), [dark]);
  return (
    <ConfigProvider theme={antTheme}>
      <App className="parquet-app">
        <ParquetViewer />
      </App>
    </ConfigProvider>
  );
}
