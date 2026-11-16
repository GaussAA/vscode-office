import { App, ConfigProvider } from "antd";
import type { ColumnsType, TableRef } from "antd/es/table";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "@vscode/codicons/dist/codicon.css";
import { $t } from "../../i18n/i18nConfig.ts";
import { RequestGuard } from "../../util/requestGuard.ts";
import { handler } from "../../util/vscode.ts";
import { useVscodeDarkTheme } from "../../util/vscodeTheme.ts";
import { formatRowRange } from "./parquetAnnounce.ts";
import { arrayBufferFromPayload } from "../../util/loadOfficeContent.ts";
import { openParquetSource } from "../../util/parquetSource.ts";
import type { OfficeOpenMessage } from "@/common/openPayload";
import type {
  ParquetColumnScan,
  ParquetColumnScanPayload,
  ParquetProfile,
  ParquetProfilePayload,
} from "@/common/parquetProfileTypes";
import { ParquetSession, type PagingSnapshot } from "./parquetSession.ts";
import { describeParquetFailure } from "./parquetError.ts";
import {
  PARQUET_CHUNK_SIZE,
  openParquetFile,
  readParquetRows,
  type ParquetColumnInfo,
  type ParquetFileInfo,
} from "./parquetParser.ts";
import { parquetAntdTheme } from "./parquetAntdTheme.ts";
import {
  MIN_ROWS_PER_PAGE,
  ROW_HEIGHT,
  SIDER_DEFAULT,
  SIDER_MAX,
  SIDER_MIN,
  pageSizeForBodyHeight,
} from "./parquetLayout.ts";
import { loadPersistedRow, savePersistedRow } from "./parquetPersistence.ts";
import { type CellCursor, type TableRow } from "./parquetCell.tsx";

import ParquetTopBar from "./ParquetTopBar.tsx";
import ParquetPager from "./ParquetPager.tsx";
import ParquetSchema from "./ParquetSchema.tsx";
import ParquetColumnPanel from "./ParquetColumnPanel.tsx";
import ParquetInspector from "./ParquetInspector.tsx";
import ParquetGuard from "./ParquetGuard.tsx";
import ParquetErrorPane from "./ParquetErrorPane.tsx";
import { useParquetInspection } from "./useParquetInspection.ts";
import { useParquetColumnLayout } from "./useParquetColumnLayout.ts";
import { useParquetSiderResize } from "./useParquetSiderResize.ts";
import { useParquetColumnFocus } from "./useParquetColumnFocus.ts";
import { useParquetSearch } from "./useParquetSearch.ts";
import ParquetTable from "./ParquetTable.tsx";
import { buildParquetColumns } from "./parquetColumns.tsx";
import { resolveParquetKey } from "./parquetKeymap.ts";
import { ErrorBoundary } from "../../components/ErrorBoundary.tsx";
import "./Parquet.less";

/**
 * Run background work when the page is idle. Prefetching the next chunk is a full data page per
 * column and runs on the same thread as React; let the visible render go first.
 */
function schedulePrefetch(run: () => void): () => void {
  if (typeof requestIdleCallback === "function") {
    const handle = requestIdleCallback(run, { timeout: 1_500 });
    return () => cancelIdleCallback(handle);
  }
  const handle = window.setTimeout(run, 250);
  return () => window.clearTimeout(handle);
}

/** What the view shows before a session has measured anything. The session owns the real values. */
const UNMEASURED_PAGING: PagingSnapshot = { pageSize: MIN_ROWS_PER_PAGE, totalPages: 1 };

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
   * The column profile, or null while it is unknown.
   *
   * It arrives from the host after the file opens (ADR-0020): the webview never reads the
   * footer itself, and a failed profile simply leaves every row without a badge rather than
   * showing a zero.
   */
  const [profile, setProfile] = useState<ParquetProfile | null>(null);
  const profileRequest = useRef(new RequestGuard());
  /**
   * The column whose profile panel is docked above the bottom bar.
   *
   * One panel at a time; it closes when a cell is inspected, because both panels occupy the
   * same slot and two of them would overlap.
   */
  const [profilePanel, setProfilePanel] = useState<{ column: ParquetColumnInfo } | null>(null);
  const [columnScan, setColumnScan] = useState<ParquetColumnScan | null>(null);
  const [scanLoading, setScanLoading] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const scanRequest = useRef(new RequestGuard());
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
  /** Owns the page cache, cancellation and the page<->row arithmetic. */
  const sessionRef = useRef<ParquetSession | null>(null);
  const { siderWidth, setSiderWidth, beginResize, moveResize, endResize } = useParquetSiderResize();
  const tableWrapRef = useRef<HTMLDivElement | null>(null);
  /**
   * The one mirror of the session's page size and page count, so renders can read them. It only
   * ever holds `session.paging` (or the unmeasured placeholder); nothing here computes a page
   * number or a page count, and nothing but the measuring effect writes it.
   */
  const [paging, setPaging] = useState<PagingSnapshot>(UNMEASURED_PAGING);
  const { pageSize, totalPages } = paging;
  const [tableBodyHeight, setTableBodyHeight] = useState(320);
  const [tableBodyWidth, setTableBodyWidth] = useState(0);
  /** Bumped when the page size changes, so the page loader runs against the new slicing. */
  const [reloadToken, setReloadToken] = useState(0);
  const [pageRows, setPageRows] = useState<Record<string, unknown>[]>([]);
  const [loadedPage, setLoadedPage] = useState(0);
  const [loadedStart, setLoadedStart] = useState(0);
  const [pageLoading, setPageLoading] = useState(false);
  const {
    layout: columnLayout,
    setColumnWidth,
    resetColumnWidth,
  } = useParquetColumnLayout(fileInfo?.columns ?? [], tableBodyWidth);

  /** The virtual table owns scrolling; cursor moves and row jumps go through its ref. */
  const tableRef = useRef<TableRef>(null);
  /** Pending focus retry while the virtual list renders the cursor's row. */
  const focusTimer = useRef(0);
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

  const { activeColumn, setActiveColumn, focusColumn } = useParquetColumnFocus({
    fileInfoRef,
    tableWrapRef,
  });

  // Keep the cursor in a ref as well as state: several keydowns can arrive before React
  // re-renders, and each one must move from the position the previous one reached.
  const selectCell = useCallback((next: CellCursor | null) => {
    cursorRef.current = next;
    setCursor(next);
    // Selecting a cell opens the value panel in the same dock the profile panel uses; close
    // the profile here rather than in an effect, so the update has an event behind it.
    setProfilePanel(null);
  }, []);

  // Every page change drops the inspector, the cursor and the jump highlight: they all
  // point at rows on the old page. `jumpToRow` re-sets the highlight right after this.
  /**
   * What a screen reader hears about navigation and search.
   *
   * One region, latest event wins: selection is announced by the inspector (it owns the
   * debounced per-cell message), and this one carries the two answers the reader cannot
   * otherwise get — which page arrived, and whether a search found anything.
   */
  const [announcement, setAnnouncement] = useState("");

  const announcePage = useCallback(
    (start: number, loaded: number) => {
      const total = fileInfoRef.current?.rowCount ?? 0;
      setAnnouncement(formatRowRange(start, loaded, total));
    },
    [fileInfoRef],
  );

  const announceSearch = useCallback((matches: number) => {
    setAnnouncement(
      matches === 1
        ? $t("parquet.matchCountOne", { count: 1 })
        : $t("parquet.matchCountMany", { count: matches }),
    );
  }, []);

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
    onSearched: announceSearch,
    fileInfoRef,
    sessionRef,
    page,
    goToPage,
    focusColumn,
    onError: setError,
  });
  const { query, matchRows, resetSearch } = search;

  const onPageLoadedRef = useRef<((start: number, loaded: number) => void) | undefined>(
    announcePage,
  );

  useEffect(() => {
    onPageLoadedRef.current = announcePage;
  }, [announcePage]);

  const resetPage = useCallback(() => {
    setPageRows([]);
    setLoadedPage(0);
    setLoadedStart(0);
    setPageLoading(false);
    setPaging(UNMEASURED_PAGING);
  }, []);

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
      setProfile(null);
      // Everything the previous document asked the host is now unwanted. The profile request
      // is only re-issued once this file has opened, so without this a late reply from the old
      // file lands in the gap; and a column scan has no other reset, so its reply would paint
      // the old column's statistics onto the new file.
      profileRequest.current.cancel();
      scanRequest.current.cancel();
      setProfilePanel(null);
      setColumnScan(null);
      setScanError(null);
      setScanLoading(false);
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
        // Ask the host for the profile in the same turn the file opens. Request ids are
        // monotonic, so a reply that belongs to the previous document is ignored instead of
        // painting another file's null rates.
        handler.emit("parquetProfile", { requestId: profileRequest.current.issue() });
        // Come back to where this document was left. The page cannot be computed yet — a page
        // is a screenful, and this document has not been measured — so remember the row and let
        // the measuring effect turn it into a page.
        documentKeyRef.current = payload.path;

        const session = new ParquetSession(
          {
            rowCount: info.rowCount,
            readRows: (start, end) =>
              readParquetRows(info.file, info.metadata, start, end, { utf8: false }),
          },
          // Not measured yet: the measuring effect fits the session to the viewport. Reading the
          // view's `pageSize` here would put it in this callback's dependencies, and the `open`
          // handler below is re-registered (and re-`init`ed, so the document reloads) whenever
          // this callback changes identity.
          { pageSize: MIN_ROWS_PER_PAGE, chunkSize: PARQUET_CHUNK_SIZE },
        );
        session.restoreToRow(loadPersistedRow(payload.path));
        sessionRef.current = session;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load parquet file");
      } finally {
        setLoading(false);
      }
    },
    [resetPage, resetSearch, selectCell, setActiveColumn],
  );

  // Resize observer: measure the table body and update page size
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
      const session = sessionRef.current;
      if (!session) return;
      // The session decides whether this is a change, and which page keeps the reader where they
      // were (the restore row on the first sizing, the row on screen afterwards). The view only
      // mirrors the result; it never compares against its own copy of the size.
      const nextPage = session.fitPageSize(pageSizeForBodyHeight(bodyHeight));
      if (nextPage !== null) {
        setPage(nextPage);
        setReloadToken((token) => token + 1);
      }
      // Same object while the size is unchanged, so this only re-renders on a real change.
      setPaging(session.paging);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [fileInfo, sessionRef, siderWidth, tableWrapRef]);

  // Page loading effect
  useEffect(() => {
    const session = sessionRef.current;
    if (!session) return;
    setPageLoading(true);
    // Aborted from the cleanup rather than flipping a captured `let`: the session already
    // guards staleness, this only stops a superseded page from writing state.
    const controller = new AbortController();
    let cancelPrefetch: (() => void) | undefined;
    void session
      .showPage(page)
      .then((snapshot) => {
        if (controller.signal.aborted || snapshot.stale) return;
        setPageRows(snapshot.rows);
        setLoadedPage(page);
        setLoadedStart(snapshot.start);
        onPageLoadedRef.current?.(snapshot.start, snapshot.rows.length);
        setPageLoading(false);
        // Prefetch only once this page is on screen. Idle time keeps a cache hit fast.
        cancelPrefetch = schedulePrefetch(() => {
          if (!controller.signal.aborted) session.prefetch(page + 1);
        });
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setPageLoading(false);
        setError(cause instanceof Error ? cause.message : "Failed to read rows");
      });
    return () => {
      controller.abort();
      cancelPrefetch?.();
    };
  }, [fileInfo, page, reloadToken, sessionRef]);

  // Persistence effect: save the current row position
  useEffect(() => {
    // Nothing to remember before the first page has actually arrived — and while a restore is
    // still pending, the page-0 load that wins the race must not write over the stored row.
    const session = sessionRef.current;
    if (!fileInfo || pageRows.length === 0 || !session || session.isRestorePending) return;
    savePersistedRow(documentKeyRef.current, loadedStart);
  }, [documentKeyRef, fileInfo, loadedStart, pageRows.length, sessionRef]);

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

  // Registered once: the webview bridge keeps one listener per event, so re-registering on
  // every document would be a no-op at best.
  useEffect(() => {
    handler.on("parquetProfileData", (payload: ParquetProfilePayload | undefined) => {
      if (!payload || !profileRequest.current.isCurrent(payload.requestId)) return;
      profileRequest.current.settle(payload.requestId);
      setProfile(payload.profile);
    });
  }, []);

  useEffect(() => {
    handler.on("parquetColumnScanData", (payload: ParquetColumnScanPayload | undefined) => {
      if (!payload || !scanRequest.current.isCurrent(payload.requestId)) return;
      scanRequest.current.settle(payload.requestId);
      setScanLoading(false);
      if (payload.scan) setColumnScan(payload.scan);
      else setScanError(payload.error ?? "The scan failed.");
    });
  }, []);

  /**
   * Esc closes the panel and puts focus back on the field row that opened it.
   *
   * The row is found by `data-column` rather than through a ref map: the schema list owns its
   * own roving focus, and handing it a map of 60 refs to save one query is not a trade worth
   * making.
   */
  const closeProfilePanel = useCallback(() => {
    const name = profilePanel?.column.name;
    // Nobody is waiting for the scan any more; a late reply must not fill the next panel.
    scanRequest.current.cancel();
    setProfilePanel(null);
    setColumnScan(null);
    setScanError(null);
    setScanLoading(false);
    if (!name) return;
    const row = Array.from(
      document.querySelectorAll<HTMLElement>(".parquet-viewer__list-item"),
    ).find((element) => element.dataset.column === name);
    row?.focus();
  }, [profilePanel]);

  const startScan = useCallback((column: ParquetColumnInfo) => {
    const requestId = scanRequest.current.issue();
    setScanLoading(true);
    setScanError(null);
    setColumnScan(null);
    handler.emit("parquetColumnScan", { requestId, name: column.name });
  }, []);

  const openProfilePanel = useCallback(
    (column: ParquetColumnInfo) => {
      // The value panel docks in the same slot; one of them at a time.
      setInspected(null);
      // A scan still running for the previous column must not answer for this one: when this
      // column has no statistics no new scan is issued, so nothing else would make it stale.
      scanRequest.current.cancel();
      setProfilePanel({ column });
      setColumnScan(null);
      setScanError(null);
      const stats = profile?.columns.find((candidate) => candidate.name === column.name);
      // The scan decodes, so it stays opt-in where there is nothing to lose by asking first:
      // a file whose writer omitted statistics gets an explicit "Scan this column".
      if (stats === undefined || stats.state === "missing") {
        setScanLoading(false);
        return;
      }
      startScan(column);
    },
    [profile, startScan],
  );

  useEffect(() => {
    if (!profilePanel) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeProfilePanel();
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [profilePanel, closeProfilePanel]);

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
      const session = sessionRef.current;
      if (!session) return;
      goToPage(session.rowToPage(row));
      setTargetRow(row);
    },
    [rowJump, goToPage, message],
  );

  // Bring the jumped-to row into view once its page has rendered; without this the right page
  // loads but the target row can sit below the fold and the user hunts for it. With a virtual
  // table the row may not be in the DOM at all, so the scroller is asked instead of the DOM.
  useEffect(() => {
    if (targetRow == null) return;
    const session = sessionRef.current;
    if (!session) return;
    const index = targetRow - session.pageToRow(page);
    if (index < 0 || index >= pageRows.length) return;
    tableRef.current?.scrollTo({ index });
  }, [targetRow, page, pageRows, sessionRef]);

  const rowRange = useMemo(() => {
    if (!fileInfo) return "";
    // An empty file says so once, in the body. Repeating it in the footer made the bottom bar
    // look like a failure message.
    if (fileInfo.rowCount === 0) return "";
    // What is on screen, which during a page load is still the previous page.
    return formatRowRange(loadedStart, pageSize, fileInfo.rowCount);
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
      // React.KeyboardEvent.target is EventTarget; in DOM it's always an Element
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) {
        return;
      }
      const pageCount = totalPages;
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
      totalPages,
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
      {/* Navigation and search have no other way out for a screen reader: the pager updates a
          label that nothing speaks, and a finished search only changes a number in the bar.
          Latest event wins in one region — a region per surface would interrupt itself. */}
      <span
        className="parquet-viewer__sr-only parquet-viewer__announce"
        role="status"
        aria-live="polite"
      >
        {announcement}
      </span>
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
              profile={profile}
              onFocusColumn={focusColumn}
              onInspectColumn={openProfilePanel}
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
            <ParquetTable
              tableRef={tableRef}
              tableWrapRef={tableWrapRef}
              fileName={fileName}
              fileInfo={fileInfo}
              cursor={cursor}
              pageSize={pageSize}
              loadedStart={loadedStart}
              tableBodyHeight={tableBodyHeight}
              tableRows={tableRows}
              tableColumns={tableColumns}
              matchRows={matchRows}
              targetRow={targetRow}
              columnLayout={columnLayout}
              onKeyDown={handleTableKeyDown}
            />
          </div>
          <footer className="parquet-viewer__bottombar">
            {profilePanel && (
              <ParquetColumnPanel
                column={profilePanel.column}
                stats={profile?.columns.find(
                  (candidate) => candidate.name === profilePanel.column.name,
                )}
                scan={columnScan}
                loading={scanLoading}
                error={scanError}
                onScan={() => startScan(profilePanel.column)}
                onClose={closeProfilePanel}
              />
            )}
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
    <ErrorBoundary>
      <ConfigProvider theme={antTheme}>
        <App className="parquet-app">
          <ParquetViewer dark={dark} />
        </App>
      </ConfigProvider>
    </ErrorBoundary>
  );
}
