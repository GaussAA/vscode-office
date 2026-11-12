import { App, ConfigProvider, Table } from "antd";
import type { ColumnsType, TableRef } from "antd/es/table";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "@vscode/codicons/dist/codicon.css";
import { $t } from "../../i18n/i18nConfig.ts";
import { handler } from "../../util/vscode.ts";
import { useVscodeDarkTheme } from "../../util/vscodeTheme.ts";
import { arrayBufferFromPayload } from "../../util/loadOfficeContent.ts";
import { openParquetSource } from "../../util/parquetSource.ts";
import type { OfficeOpenMessage } from "@/common/openPayload";
import { ParquetSession } from "./parquetSession.ts";
import { describeParquetFailure } from "./parquetError.ts";
import {
  PARQUET_CHUNK_SIZE,
  PARQUET_PAGE_SIZE,
  openParquetFile,
  readParquetRows,
  type ParquetFileInfo,
} from "./parquetParser.ts";
import { parquetAntdTheme } from "./parquetAntdTheme.ts";
import {
  MIN_ROWS_PER_PAGE,
  PARQUET_MAX_PAGE_SIZE,
  ROW_HEIGHT,
  SIDER_DEFAULT,
  SIDER_MAX,
  SIDER_MIN,
} from "./parquetLayout.ts";
import { loadPersistedRow } from "./parquetPersistence.ts";
import { PresentationTable, ResizableHeaderCell } from "./parquetHeaders.tsx";
import { CursorContext, type CellCursor, type TableRow } from "./parquetCell.tsx";

import ParquetTopBar from "./ParquetTopBar.tsx";
import ParquetPager from "./ParquetPager.tsx";
import ParquetSchema from "./ParquetSchema.tsx";
import ParquetInspector from "./ParquetInspector.tsx";
import ParquetGuard from "./ParquetGuard.tsx";
import ParquetErrorPane from "./ParquetErrorPane.tsx";
import { useParquetInspection } from "./useParquetInspection.ts";
import { useParquetColumnLayout } from "./useParquetColumnLayout.ts";
import { useParquetSiderResize } from "./useParquetSiderResize.ts";
import { useParquetColumnFocus } from "./useParquetColumnFocus.ts";
import { useParquetSearch } from "./useParquetSearch.ts";
import { useParquetPage } from "./useParquetPage.ts";
import { buildParquetColumns } from "./parquetColumns.tsx";
import { resolveParquetKey } from "./parquetKeymap.ts";
import "./Parquet.less";

/** A virtual document arrives as inline base64; a local one as a fetchable path. */
type ParquetOpenPayload = Pick<OfficeOpenMessage, "path" | "buffer" | "bufferBase64"> & {
  fileName?: string;
  ext?: string;
  size?: number;
  tooLarge?: boolean;
};
function ParquetViewer({ dark }: { dark: boolean }) {
  const { message } = App.useApp();
  const [fileInfo, setFileInfo] = useState<ParquetFileInfo | null>(null);
  /**
   * The page `pageRows` actually came from. Row identity — the `#` column, `aria-rowindex`, the
   * inspector's row number — must derive from this, not from `page`: `page` changes on the click,
   * the rows arrive 0.5–1.7 s later, and in between every row number was a lie (a stale value
   * under a fresh label, and an `aria-live` announcement of it).
   */
  /** Row to return to once the page size is known; consumed by the measuring effect. */
  const restoreRowRef = useRef(0);
  /** True until the restored page has actually loaded; nothing may be persisted before that. */
  const restorePendingRef = useRef(false);
  /** Bumped when the page size changes, so the page loader runs again against the new slicing. */
  const [reloadToken, setReloadToken] = useState(0);
  const [rowJump, setRowJump] = useState<number | null>(null);
  const [inspected, setInspected] = useState<{
    row: number;
    column: string;
    value: unknown;
  } | null>(null);
  /**
   * The value panel. Collapsed, the bottom bar stays one line; expanded, it shows the whole value
   * wrapped over a few lines with its size and a raw/formatted switch. This replaces the native
   * `title` the cells used to carry — a tooltip cannot be selected, wrapped or copied, and
   * DESIGN.md forbids it as the only way to read a value.
   */
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Shown in the error state too: that is the one state where the chrome is gone. */
  const [fileName, setFileName] = useState("");
  /** Set when the host refused to inline an oversized virtual document. */
  const [tooLarge, setTooLarge] = useState<{
    size: number;
    name: string;
    ext: string;
  } | null>(null);
  /** True once the user answered "open anyway": the retry must not be gated again. */
  const forcedRef = useRef(false);
  const lastPathRef = useRef<string | undefined>(undefined);
  /** Keyboard cursor into the grid; null until an arrow key (or a click) lands somewhere. */
  const [cursor, setCursor] = useState<CellCursor | null>(null);
  const { siderWidth, setSiderWidth, beginResize, moveResize, endResize } = useParquetSiderResize();
  /** Rows per page. A page is one screenful, so this follows the body height. */
  const [pageSize, setPageSize] = useState(PARQUET_PAGE_SIZE);
  const pageSizeRef = useRef(PARQUET_PAGE_SIZE);
  const [tableBodyHeight, setTableBodyHeight] = useState(320);
  const [tableBodyWidth, setTableBodyWidth] = useState(0);
  const {
    layout: columnLayout,
    setColumnWidth,
    resetColumnWidth,
  } = useParquetColumnLayout(fileInfo?.columns ?? [], tableBodyWidth);

  /** The virtual table owns scrolling; cursor moves and row jumps go through its ref. */
  const tableRef = useRef<TableRef>(null);
  /** Pending focus retry while the virtual list renders the cursor's row. */
  const focusTimer = useRef(0);
  const tableWrapRef = useRef<HTMLDivElement | null>(null);
  const cursorRef = useRef<CellCursor | null>(null);
  /** The full text of the current selection, for Ctrl+C on the grid. */
  const inspectedCopyRef = useRef("");
  /** Where the cursor should land once a page turned by keyboard has loaded. */
  const pendingCursor = useRef<{ where: "first" | "last"; col: number } | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  /** Absolute row the footer jump aimed at, highlighted until the next navigation. */
  const [targetRow, setTargetRow] = useState<number | null>(null);
  const fileInfoRef = useRef<ParquetFileInfo | null>(null);
  /** localStorage key of the open document; empty for inline (virtual) buffers. */
  const documentKeyRef = useRef<string | undefined>(undefined);
  /** Owns the page cache, cancellation and the page<->row arithmetic. */
  const sessionRef = useRef<ParquetSession | null>(null);

  const { activeColumn, setActiveColumn, focusColumn } = useParquetColumnFocus({
    fileInfoRef,
    tableWrapRef,
  });

  // Keep the cursor in a ref as well as state: several keydowns can arrive before React
  // re-renders, and each one must move from the position the previous one reached.
  const selectCell = useCallback((next: CellCursor | null) => {
    cursorRef.current = next;
    setCursor(next);
  }, []);

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

  const search = useParquetSearch({
    fileInfoRef,
    page,
    pageSize,
    goToPage,
    focusColumn,
    onError: setError,
  });
  const { query, matchRows, resetSearch } = search;

  const { pageRows, loadedPage, loadedStart, pageLoading, loadedStartRef, resetPage } =
    useParquetPage({
      fileInfo,
      page,
      reloadToken,
      sessionRef,
      documentKeyRef,
      restoreRowRef,
      restorePendingRef,
      onError: setError,
    });

  /** Briefly true right after a copy, so the button can answer instead of staying silent. */
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef(0);

  /** One copy path: clipboard, then a receipt. Silence after "Copy" reads as "nothing happened". */
  const copyValue = useCallback((text: string) => {
    void navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);
        window.clearTimeout(copyTimer.current);
        copyTimer.current = window.setTimeout(() => setCopied(false), 1200);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => () => window.clearTimeout(copyTimer.current), []);

  const totalPages = useMemo(() => {
    if (!fileInfo?.rowCount) return 1;
    return Math.max(1, Math.ceil(fileInfo.rowCount / pageSize));
  }, [fileInfo, pageSize]);

  const tableRows = useMemo<TableRow[]>(() => {
    return pageRows.map((row, index) => ({
      ...row,
      key: `${page}-${index}`,
    }));
  }, [pageRows, page]);

  const loadParquet = useCallback(
    async (payload: ParquetOpenPayload) => {
      setLoading(true);
      setError(null);
      setFileInfo(null);
      fileInfoRef.current = null;
      sessionRef.current?.reset();
      sessionRef.current = null;
      resetPage();
      setInspected(null);
      selectCell(null);
      setActiveColumn(null);
      setTargetRow(null);
      resetSearch(true);
      // Clear the key before resetting the page, otherwise the reset would be persisted
      // against the document we are leaving.
      documentKeyRef.current = undefined;
      setPage(0);
      try {
        // Files arrive either as an inline base64 payload (virtual documents) or as a
        // fetchable URI. For URIs we probe Range support so hyparquet pulls only the
        // footer and the pages it needs, instead of the whole file.
        const info =
          payload.bufferBase64 || payload.buffer?.length
            ? await openParquetFile(arrayBufferFromPayload(payload))
            : await openParquetFile((await openParquetSource(payload.path ?? "")).file);
        fileInfoRef.current = info;
        setFileInfo(info);
        // Come back to where this document was left. The page cannot be computed yet — a page
        // is a screenful, and this document has not been measured — so remember the row and let
        // the measuring effect turn it into a page.
        documentKeyRef.current = payload.path;
        restoreRowRef.current = loadPersistedRow(payload.path);
        restorePendingRef.current = restoreRowRef.current !== 0;

        sessionRef.current = new ParquetSession(
          {
            rowCount: info.rowCount,
            readRows: (start, end) =>
              readParquetRows(info.file, info.metadata, start, end, { utf8: false }),
          },
          { pageSize: pageSizeRef.current, chunkSize: PARQUET_CHUNK_SIZE },
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load parquet file");
      } finally {
        setLoading(false);
      }
    },
    [resetPage, resetSearch, selectCell, setActiveColumn],
  );

  // The table body gets the height the flex column actually leaves it, instead of a
  // `100vh - N` guess that turns into an unexplained gap whenever the bars change.
  useEffect(() => {
    const element = tableWrapRef.current;
    if (!element || !fileInfo) return;
    const update = () => {
      const header = element.querySelector<HTMLElement>(".ant-table-header");
      const headerHeight = header?.offsetHeight ?? 38;
      const bodyHeight = Math.max(80, Math.round(element.clientHeight - headerHeight));
      setTableBodyHeight(bodyHeight);
      setTableBodyWidth(element.clientWidth);
      // A page is one screenful: the pager's row range should describe the rows you can see.
      // `setPageSize` keeps the decoded chunks, so re-paging never costs a read.
      const rows = Math.max(MIN_ROWS_PER_PAGE, Math.floor(bodyHeight / ROW_HEIGHT));
      if (rows !== pageSizeRef.current) {
        const clamped = Math.min(rows, PARQUET_MAX_PAGE_SIZE);
        pageSizeRef.current = clamped;
        // Which page holds the row we want? On the very first sizing that is the persisted row
        // (the page number cannot be computed before the page size is known); afterwards it is
        // the row already on screen, so a resize does not move the reader.
        const keepRow = restoreRowRef.current || loadedStartRef.current;
        restoreRowRef.current = 0;
        const session = sessionRef.current;
        if (session) setPage(session.setPageSize(clamped, keepRow));
        setPageSize(clamped);
        setReloadToken((token) => token + 1);
      }
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [fileInfo, loadedStartRef, siderWidth]);
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

  const jumpToRow = useCallback(
    (warnWhenEmpty = true) => {
      const info = fileInfoRef.current;
      if (!info) return;
      if (info.rowCount === 0) {
        if (warnWhenEmpty) message.warning($t("parquet.invalidRow"));
        return;
      }
      // Fail loud on an explicit Enter/Go; a blur with an empty box is just a no-op.
      if (rowJump == null) {
        if (warnWhenEmpty) message.warning($t("parquet.invalidRow"));
        return;
      }
      const row = Math.max(0, Math.min(info.rowCount - 1, Math.round(rowJump) - 1));
      goToPage(Math.floor(row / pageSize));
      setTargetRow(row);
    },
    [rowJump, goToPage, pageSize, message],
  );

  // Bring the jumped-to row into view once its page has rendered; without this the right page
  // loads but the target row can sit below the fold and the user hunts for it. With a virtual
  // table the row may not be in the DOM at all, so the scroller is asked instead of the DOM.
  useEffect(() => {
    if (targetRow == null) return;
    const index = targetRow - page * pageSize;
    if (index < 0 || index >= pageRows.length) return;
    tableRef.current?.scrollTo({ index });
  }, [targetRow, page, pageSize, pageRows]);

  const rowRange = useMemo(() => {
    if (!fileInfo) return "";
    // An empty file says so once, in the body. Repeating it in the footer made the bottom bar
    // look like a failure message.
    if (fileInfo.rowCount === 0) return "";
    // What is on screen, which during a page load is still the previous page.
    const start = loadedStart + 1;
    const end = Math.min(fileInfo.rowCount, loadedStart + pageSize);
    return `${start.toLocaleString()}–${end.toLocaleString()} of ${fileInfo.rowCount.toLocaleString()}`;
  }, [fileInfo, loadedStart, pageSize]);

  /**
   * Move the cursor *and* show the cell in the bottom bar. A focus ring the inspector disagrees
   * with is worse than no ring at all, and two of the cursor's entry points (the first arrow of a
   * cold start, and the row restored after a keyboard page turn) used to skip the inspector.
   */
  const revealCursor = useCallback(
    (next: CellCursor | null) => {
      selectCell(next);
      if (!next) return;
      const column = fileInfo?.columns[next.col];
      const row = pageRows[next.row];
      if (!column || !row) return;
      setInspected({
        row: loadedStart + next.row,
        column: column.name,
        value: row[column.name],
      });
    },
    [selectCell, fileInfo, loadedStart, pageRows],
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
      const pageCount = Math.max(1, Math.ceil(fileInfo.rowCount / pageSize));
      const visibleRows = Math.max(1, Math.floor(tableBodyHeight / ROW_HEIGHT));
      const action = resolveParquetKey({
        key: event.key,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        cursor: cursorRef.current,
        rows: pageRows.length,
        cols: fileInfo.columns.length,
        page,
        pageCount,
        visibleRows,
        hasCopy: Boolean(inspectedCopyRef.current),
      });
      switch (action.type) {
        case "escape":
          selectCell(null);
          setInspected(null);
          tableWrapRef.current?.focus();
          return;
        case "inspect": {
          const current = cursorRef.current;
          const column = current ? fileInfo.columns[current.col] : undefined;
          const row = current ? pageRows[current.row] : undefined;
          if (current && row && column) {
            setInspected({
              row: loadedStart + current.row,
              column: column.name,
              value: row[column.name],
            });
          }
          return;
        }
        case "copy":
          event.preventDefault();
          copyValue(inspectedCopyRef.current);
          return;
        case "turn": {
          event.preventDefault();
          if (action.page === page) return;
          pendingCursor.current = { where: action.where, col: cursorRef.current?.col ?? 0 };
          goToPage(action.page);
          return;
        }
        case "reveal": {
          event.preventDefault();
          revealCursor({ row: action.row, col: action.col });
          const isMove = [
            "ArrowDown",
            "ArrowUp",
            "ArrowLeft",
            "ArrowRight",
            "Home",
            "End",
          ].includes(event.key);
          const nextColumn = fileInfo.columns[action.col];
          const nextRow = pageRows[action.row];
          if (isMove && nextColumn && nextRow) {
            setInspected({
              row: loadedStart + action.row,
              column: nextColumn.name,
              value: nextRow[nextColumn.name],
            });
          }
          return;
        }
        case "none":
          return;
      }
    },
    [
      fileInfo,
      page,
      pageSize,
      loadedStart,
      pageRows,
      selectCell,
      goToPage,
      tableBodyHeight,
      revealCursor,
      copyValue,
    ],
  );

  // A page turned from the keyboard has to put the cursor back: `goToPage` clears it, and the
  // row it should land on ("last" = the previous page's final row) is only known once the new
  // page's rows have arrived.
  useEffect(() => {
    const pending = pendingCursor.current;
    // Both halves have to agree before the cursor is restored: applying it against the previous
    // page's rows is what put "row 1" next to a value from row 251.
    if (!pending || pageRows.length === 0 || loadedPage !== page) return;
    pendingCursor.current = null;
    revealCursor({ row: pending.where === "first" ? 0 : pageRows.length - 1, col: pending.col });
  }, [pageRows, loadedPage, page, revealCursor]);

  // Move real focus with the cursor. A focusable cell is what makes the roving tabindex
  // work for assistive tech; the scroll keeps the focused cell in view. A virtual table may not
  // have rendered the cell yet, so scroll the row into the window and retry the focus for a few
  // frames instead of assuming it exists.
  useEffect(() => {
    if (!cursor) return;
    tableRef.current?.scrollTo({ index: cursor.row });
    const attempt = (tries: number): void => {
      const cell = tableWrapRef.current?.querySelector<HTMLElement>(
        `[data-cell="${cursor.row}:${cursor.col}"]`,
      );
      if (!cell && tries > 0) {
        focusTimer.current = window.setTimeout(() => attempt(tries - 1), 16);
        return;
      }
      cell?.focus({ preventScroll: true });
      cell?.scrollIntoView({ block: "nearest", inline: "nearest" });
    };
    attempt(3);
    return () => window.clearTimeout(focusTimer.current);
  }, [cursor, pageRows]);

  const tableColumns = useMemo<ColumnsType<TableRow>>(
    () =>
      // oxlint-disable-next-line react/refs -- selectCell is only called by cell handlers; its ref keeps rapid key repeats in sync.
      buildParquetColumns({
        fileInfo,
        loadedStart,
        query,
        activeColumn,
        columnLayout,
        onSelectCell: (cell) => selectCell(cell),
        onActivateColumn: (position) => setActiveColumn(position),
        onInspect: (selection) => setInspected(selection),
        onResizeColumn: (name, width) => setColumnWidth(name, width),
        onResetColumn: (name) => resetColumnWidth(name),
      }),
    [
      fileInfo,
      loadedStart,
      query,
      selectCell,
      activeColumn,
      columnLayout,
      setActiveColumn,
      setInspected,
      setColumnWidth,
      resetColumnWidth,
    ],
  );

  useEffect(() => {
    handler
      .on("open", (payload: ParquetOpenPayload) => {
        if (payload.path !== lastPathRef.current) {
          // A different document: "open anyway" never carries over to it.
          forcedRef.current = false;
          lastPathRef.current = payload.path;
        }
        setFileName(payload.fileName ?? "");
        // Only virtual documents are gated: a local file is paged with range requests, so its
        // size is irrelevant; one that arrives inline pays for the whole file at once.
        if (!forcedRef.current && payload.tooLarge) {
          setTooLarge({
            size: payload.size ?? 0,
            name: payload.fileName ?? "",
            ext: payload.ext ?? ".parquet",
          });
          setLoading(false);
          return;
        }
        setTooLarge(null);
        void loadParquet(payload);
      })
      .emit("init");
  }, [loadParquet]);

  const inspection = useParquetInspection(inspected, fileInfo?.columns ?? []);

  useEffect(() => {
    inspectedCopyRef.current = inspection.full;
  }, [inspection.full]);

  /** The compression the file arrived in. This fork exists to open the ZSTD ones; the surface
   *  used to say nothing about the reason it worked at all. */
  const codecs = useMemo(() => {
    const seen = new Set<string>();
    for (const group of fileInfo?.metadata?.row_groups ?? []) {
      for (const column of group.columns ?? []) {
        const codec = column.meta_data?.codec;
        if (codec) seen.add(String(codec));
      }
    }
    return [...seen];
  }, [fileInfo]);

  /** Library message → the sentence a reader can act on, plus the original for the details. */
  const failure = describeParquetFailure(error);

  /** The host refused to inline an oversized virtual document; ask it to read it anyway. */
  const handleOpenAnyway = useCallback(() => {
    forcedRef.current = true;
    setTooLarge(null);
    setLoading(true);
    handler.emit("openForce");
  }, []);

  return (
    <div className={`parquet-viewer${dark ? "" : " parquet-viewer--light"}`}>
      {tooLarge && !loading && (
        <ParquetGuard
          tooLarge={tooLarge}
          onOpenAnyway={handleOpenAnyway}
          onRevealFile={() => handler.emit("revealFile")}
        />
      )}
      {loading && (
        <div className="parquet-viewer__overlay">
          <span className="codicon codicon-loading codicon-modifier-spin" />
          <span>{$t("parquet.loading")}</span>
        </div>
      )}
      {failure ? (
        <ParquetErrorPane
          failure={failure}
          fileName={fileName}
          copied={copied}
          onCopy={copyValue}
          onRevealFile={() => handler.emit("revealFile")}
          onRetry={() => handler.emit("init")}
        />
      ) : fileInfo ? (
        <>
          <ParquetTopBar
            search={search}
            searchInputRef={searchInputRef}
            fileInfo={fileInfo}
            codecs={codecs}
          />
          <div className="parquet-viewer__body">
            <ParquetSchema
              columns={fileInfo.columns}
              activeColumn={activeColumn}
              siderWidth={siderWidth}
              onFocusColumn={focusColumn}
            />
            <div
              className="parquet-viewer__resizer"
              role="separator"
              aria-orientation="vertical"
              aria-label={$t("parquet.resizeSidebar")}
              aria-valuemin={SIDER_MIN}
              aria-valuemax={SIDER_MAX}
              aria-valuenow={siderWidth}
              tabIndex={0}
              onPointerDown={beginResize}
              onPointerMove={moveResize}
              onPointerUp={endResize}
              onPointerCancel={endResize}
              onLostPointerCapture={endResize}
              onDoubleClick={() => setSiderWidth(SIDER_DEFAULT)}
              onKeyDown={(event) => {
                if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                  event.preventDefault();
                  const delta = event.key === "ArrowRight" ? 16 : -16;
                  setSiderWidth((width) => width + delta);
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
              {fileInfo.rowCount === 0 ? (
                <div className="parquet-viewer__no-rows">
                  <span className="codicon codicon-table" />
                  <span>{$t("parquet.noRows")}</span>
                </div>
              ) : (
                <div
                  className="parquet-viewer__table-wrap"
                  ref={tableWrapRef}
                  tabIndex={cursor ? -1 : 0}
                  onKeyDown={handleTableKeyDown}
                  // A grid, because the keyboard model is one: roving tabindex, arrow keys,
                  // Enter to inspect. The counts are the file's, not the DOM's — only a window
                  // of rows is rendered, which is exactly what these two attributes are for.
                  role="grid"
                  aria-label={fileName || undefined}
                  aria-rowcount={fileInfo.rowCount}
                  aria-colcount={fileInfo.columns.length + 1}
                  // A page is one screenful, so its size is a runtime fact. Exposed for the UI
                  // assertions (and it documents the model in the DOM).
                  data-page-size={pageSize}
                  data-page-start={loadedStart}
                >
                  <CursorContext.Provider value={cursor}>
                    <Table<TableRow>
                      ref={tableRef}
                      virtual
                      className="parquet-table"
                      dataSource={tableRows}
                      columns={tableColumns}
                      // The empty state is rendered above instead of the table; a second copy
                      // here would only exist to be found in a screenshot.
                      locale={{ emptyText: "" }}
                      pagination={false}
                      size="small"
                      scroll={{
                        // Virtual scrolling needs numbers: x is the full column extent (or the
                        // viewport when it is wider), y is the body height measured above.
                        // The layout already accounts for the viewport; stretching past it is
                        // what blew narrow files up.
                        x: columnLayout.extent + columnLayout.filler,
                        y: tableBodyHeight,
                      }}
                      rowClassName={(_row, index) => {
                        const absolute = loadedStart + index;
                        const classes: string[] = [];
                        if (index % 2 === 1) classes.push("parquet-viewer__row--alt");
                        if (matchRows.has(absolute)) classes.push("parquet-viewer__row--match");
                        if (targetRow === absolute) classes.push("parquet-viewer__row--target");
                        return classes.join(" ");
                      }}
                      // The virtual body renders divs, so the row's grid role has to come from
                      // the same prop that carries the class. `aria-rowindex` is the absolute
                      // row, not the index within the rendered window.
                      onRow={(_row, index) => ({
                        role: "row",
                        "aria-rowindex": loadedStart + (index ?? 0) + 1,
                      })}
                      components={{
                        table: PresentationTable,
                        header: { table: PresentationTable, cell: ResizableHeaderCell },
                      }}
                    />
                  </CursorContext.Provider>
                </div>
              )}
            </main>
          </div>
          <footer className="parquet-viewer__bottombar">
            <ParquetInspector
              inspected={inspected}
              inspection={inspection}
              hasRows={fileInfo.rowCount > 0}
              copied={copied}
              onCopy={copyValue}
              onClear={() => {
                inspection.collapse();
                setInspected(null);
                tableWrapRef.current?.focus();
              }}
              onFocusTable={() => tableWrapRef.current?.focus()}
            />
            <ParquetPager
              fileInfo={fileInfo}
              page={page}
              totalPages={totalPages}
              rowRange={rowRange}
              pageLoading={pageLoading}
              rowJump={rowJump}
              onRowJump={setRowJump}
              onJump={() => jumpToRow()}
              onGoToPage={goToPage}
            />
          </footer>
        </>
      ) : null}
    </div>
  );
}

export default function Parquet() {
  const dark = useVscodeDarkTheme();
  const antTheme = useMemo(() => parquetAntdTheme(dark), [dark]);
  return (
    <ConfigProvider theme={antTheme}>
      <App className="parquet-app">
        <ParquetViewer dark={dark} />
      </App>
    </ConfigProvider>
  );
}
