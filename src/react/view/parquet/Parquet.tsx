import { App, ConfigProvider, InputNumber, Table, theme as antdTheme } from "antd";
import type { ColumnsType, TableRef } from "antd/es/table";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type HTMLAttributes,
} from "react";
import "@vscode/codicons/dist/codicon.css";
import { $t } from "../../i18n/i18nConfig.ts";
import { handler } from "../../util/vscode.ts";
import { getVscodeThemeColor, useVscodeDarkTheme } from "../../util/vscodeTheme.ts";
import { arrayBufferFromPayload } from "../../util/loadOfficeContent.ts";
import { openParquetSource } from "../../util/parquetSource.ts";
import type { OfficeOpenMessage } from "@/common/openPayload";
import { normalizeExternalUrl } from "@/common/externalLink";
import { formatBytes, previewLimitBytes } from "@/common/previewLimit";
import { highlightRuns } from "../../common/highlight.ts";
import { savePersistedState } from "../../common/persistedState.ts";
import { ParquetSession } from "./parquetSession.ts";
import { searchParquetValues } from "./parquetSearch.ts";
import { describeParquetFailure } from "./parquetError.ts";
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
import { jsonPreviewText, tokenizeJson, type JsonToken } from "./parquetPreview.ts";
import "./Parquet.less";

const PAGE_SIZE = PARQUET_PAGE_SIZE;
/** Cap on matched rows kept in memory (highlight + navigation). */
const SEARCH_MAX_ROWS = 5_000;
/** Schema sidebar bounds; the drag handle and keyboard use the same range. */
const SIDER_MIN = 208;
const SIDER_MAX = 420;
const SIDER_DEFAULT = 260;
const SIDER_STORAGE_KEY = "parquet-sider-width";
/** Must agree with the column widths passed to <Table>: the sidebar jump uses arithmetic. */
const INDEX_COLUMN_WIDTH = 64;
const DATA_COLUMN_WIDTH = 120;
/** How long a selection must hold still before it is announced to assistive tech. */
const ANNOUNCE_DELAY_MS = 600;

/**
 * antd renders the column header as its own `<table>`, and a `table` inside a `grid` is not a
 * valid child of one. Dropping the table role keeps the header cells' explicit `columnheader`
 * roles while the grid underneath owns the rows.
 */
function PresentationTable(props: HTMLAttributes<HTMLTableElement>) {
  return <table {...props} role="presentation" />;
}

/**
 * Run background work when the page is idle.
 *
 * Prefetching the next page is a full data page per column (~1.2 s on a 60-column file) and
 * it runs on the same thread as React. Started in the same tick as the visible page, it
 * delayed a cache hit to 1.7 s; `requestIdleCallback` lets the render go first, and the
 * timeout keeps a permanently busy page from starving the prefetch. Falls back to a timer
 * where rIC does not exist.
 */
function schedulePrefetch(run: () => void): () => void {
  if (typeof requestIdleCallback === "function") {
    const handle = requestIdleCallback(run, { timeout: 1_500 });
    return () => cancelIdleCallback(handle);
  }
  const handle = window.setTimeout(run, 250);
  return () => window.clearTimeout(handle);
}

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

/** A virtual document arrives as inline base64; a local one as a fetchable path. */
type ParquetOpenPayload = Pick<OfficeOpenMessage, "path" | "buffer" | "bufferBase64"> & {
  fileName?: string;
  ext?: string;
  size?: number;
  tooLarge?: boolean;
};

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
  // Only a complete http(s) value becomes a link. A description containing a URL stays a
  // description; the host validates the emitted URL again before opening anything.
  const externalUrl = isNull ? null : normalizeExternalUrl(value);
  const jsonText = isNull || externalUrl ? null : jsonPreviewText(value);
  const displayText = isNull
    ? $t("parquet.nullLabel")
    : externalUrl
      ? typeof value === "string"
        ? value.trim()
        : externalUrl
      : (jsonText ?? formatCellValue(value, column.type));
  const classes = [
    "parquet-viewer__cell",
    isNull
      ? "parquet-viewer__cell--null"
      : externalUrl
        ? "parquet-viewer__cell--link"
        : jsonText
          ? "parquet-viewer__cell--json"
          : kind === "bool"
            ? ""
            : `parquet-viewer__cell--${kind}`,
    kind === "bool" && !isNull && !externalUrl && !jsonText
      ? value === true
        ? "parquet-viewer__cell--bool-true"
        : "parquet-viewer__cell--bool-false"
      : "",
    isCursor ? "parquet-viewer__cell--cursor" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const labelText = displayText.length > 160 ? `${displayText.slice(0, 160)}…` : displayText;
  const openLink = () => {
    if (externalUrl) handler.emit("openExternal", externalUrl);
  };
  const content = isNull ? (
    $t("parquet.nullLabel")
  ) : externalUrl ? (
    <a
      className="parquet-viewer__cell-link"
      href={externalUrl}
      target="_blank"
      rel="noopener noreferrer"
      tabIndex={-1}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        openLink();
      }}
      onAuxClick={(event) => event.preventDefault()}
    >
      {highlightCell(displayText, query.trim())}
    </a>
  ) : jsonText ? (
    tokenizeJson(jsonText).map((token: JsonToken, index) => (
      <span
        key={index}
        className={`parquet-viewer__json-token parquet-viewer__json-token--${token.type}`}
      >
        {highlightCell(token.text, query.trim())}
      </span>
    ))
  ) : (
    highlightCell(displayText, query.trim())
  );

  return (
    <span
      className={classes}
      data-cell={`${pageIndex}:${position}`}
      tabIndex={isCursor ? 0 : -1}
      aria-label={`${column.name}, row ${rowIndex + 1}: ${labelText}${externalUrl ? ", external link" : ""}`}
      aria-keyshortcuts={externalUrl ? "Enter" : undefined}
      title={isNull ? "null" : displayText}
      onClick={onActivate}
      onKeyDown={(event) => {
        // The anchor is not a separate tab stop (one per URL cell would flood the grid);
        // Enter on the roving cell is the keyboard equivalent of clicking the link.
        if (externalUrl && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          event.stopPropagation();
          openLink();
        }
      }}
    >
      {content}
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

function ParquetViewer({ dark }: { dark: boolean }) {
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
  const [siderWidth, setSiderWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(SIDER_STORAGE_KEY));
      if (Number.isFinite(saved) && saved >= SIDER_MIN && saved <= SIDER_MAX) return saved;
    } catch {}
    return SIDER_DEFAULT;
  });
  const [tableBodyHeight, setTableBodyHeight] = useState(320);
  const [tableBodyWidth, setTableBodyWidth] = useState(0);
  /** The virtual table owns scrolling; cursor moves and row jumps go through its ref. */
  const tableRef = useRef<TableRef>(null);
  /** Pending focus retry while the virtual list renders the cursor's row. */
  const focusTimer = useRef(0);
  /** Field whose column the schema click last brought into view; tints it while browsing. */
  const [activeColumn, setActiveColumn] = useState<number | null>(null);
  /** Row → first matching column, for the rows the last scan kept. */
  const matchColumnsRef = useRef<Map<number, number>>(new Map());
  /** A finished scan that found nothing: that is an answer, and it has to look like one. */
  const [searchedEmpty, setSearchedEmpty] = useState(false);
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

  /**
   * Bring one field into view without changing the page or the row selection. The column
   * widths are fixed, so the target is arithmetic rather than a DOM measurement; this also
   * works while the table viewport is scrolled.
   */
  const focusColumn = useCallback((position: number, mark = true) => {
    if (mark) setActiveColumn(position);

    const geometry = () => {
      const wrap = tableWrapRef.current;
      if (!wrap) return null;
      const virtualBody = wrap.querySelector<HTMLElement>(".ant-table-tbody-virtual");
      const body =
        wrap.querySelector<HTMLElement>(".ant-table-body, .ant-table-content") ?? virtualBody;
      const viewportWidth = virtualBody?.clientWidth ?? body?.clientWidth ?? 0;
      if (!viewportWidth) return null;
      const columnLeft = INDEX_COLUMN_WIDTH + position * DATA_COLUMN_WIDTH;
      const left = Math.max(0, columnLeft - Math.max(0, (viewportWidth - DATA_COLUMN_WIDTH) / 2));
      return { wrap, virtualBody, body, viewportWidth, columnLeft, left };
    };

    /** Horizontal offset the body currently shows, however it is implemented. */
    const currentOffset = (): number | null => {
      const wrap = tableWrapRef.current;
      if (!wrap) return null;
      const inner = wrap.querySelector<HTMLElement>(".ant-table-tbody-virtual-holder-inner");
      if (inner) return wrap.getBoundingClientRect().left - inner.getBoundingClientRect().left;
      const body = wrap.querySelector<HTMLElement>(".ant-table-body, .ant-table-content");
      return body ? body.scrollLeft : null;
    };

    const columnVisible = (): boolean => {
      const g = geometry();
      const offset = currentOffset();
      if (!g || offset === null) return false;
      const relative = g.columnLeft - offset;
      return relative >= -1 && relative + DATA_COLUMN_WIDTH <= g.viewportWidth + 1;
    };

    /** One scroll attempt; false means the body was not ready and another frame may help. */
    const scrollOnce = (): boolean => {
      const g = geometry();
      if (!g) return false;

      // antd's virtual table keeps horizontal offset in rc-virtual-list rather than in a
      // scrollable DOM node, and its scrollTo only handles rows. The horizontal scrollbar is a
      // custom track, so translate the desired offset into a click on it. rc-virtual-list
      // ignores a mousedown whose target is the thumb — which is what an unmeasured track
      // produces — so the widths are checked before dispatching instead of after.
      if (g.virtualBody) {
        const track = g.wrap.querySelector<HTMLElement>(
          ".ant-table-tbody-virtual-scrollbar-horizontal",
        );
        const thumb = track?.querySelector<HTMLElement>(".ant-table-tbody-virtual-scrollbar-thumb");
        const inner = g.wrap.querySelector<HTMLElement>(".ant-table-tbody-virtual-holder-inner");
        if (!track || !thumb || !inner) return false;
        const maxScroll = Math.max(0, inner.scrollWidth - g.virtualBody.clientWidth);
        const trackRect = track.getBoundingClientRect();
        const thumbRect = thumb.getBoundingClientRect();
        const offsetRange = trackRect.width - thumbRect.width;
        if (maxScroll <= 0 || offsetRange <= 0 || thumbRect.width <= 0) return false;
        const target = Math.min(g.left, maxScroll);
        const x = trackRect.left + (target / maxScroll) * offsetRange + thumbRect.width / 2;
        track.dispatchEvent(
          new MouseEvent("mousedown", {
            bubbles: true,
            cancelable: true,
            button: 0,
            clientX: x,
            clientY: trackRect.top + trackRect.height / 2,
          }),
        );
        return true;
      }

      if (!g.body) return false;
      const behavior = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth";
      if (typeof g.body.scrollTo === "function") g.body.scrollTo({ left: g.left, behavior });
      else g.body.scrollLeft = g.left;
      return true;
    };

    // Let the active column commit first, then keep trying for a few frames. The virtual table
    // rebuilds its scrollbar whenever a column class changes, so an attempt can land on a
    // detached track — or on a live one whose geometry is still zero. Both are silent, so each
    // attempt is verified against the column actually being in view.
    requestAnimationFrame(() => {
      let tries = 6;
      const attempt = () => {
        scrollOnce();
        requestAnimationFrame(() => {
          if (columnVisible() || --tries <= 0) return;
          attempt();
        });
      };
      attempt();
    });
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
    async (payload: ParquetOpenPayload) => {
      setLoading(true);
      setError(null);
      setFileInfo(null);
      fileInfoRef.current = null;
      sessionRef.current?.reset();
      sessionRef.current = null;
      setPageRows([]);
      setInspected(null);
      selectCell(null);
      setActiveColumn(null);
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
        // Files arrive either as an inline base64 payload (virtual documents) or as a
        // fetchable URI. For URIs we probe Range support so hyparquet pulls only the
        // footer and the pages it needs, instead of the whole file.
        const info =
          payload.bufferBase64 || payload.buffer?.length
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
            readRows: (start, end) =>
              readParquetRows(info.file, info.metadata, start, end, { utf8: false }),
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
    let cancelPrefetch: (() => void) | undefined;
    void session
      .showPage(page)
      .then((snapshot) => {
        if (controller.signal.aborted || snapshot.stale) return;
        setPageRows(snapshot.rows);
        setPageLoading(false);
        // Prefetch only once this page is on screen. Decoding the *next* page is a full
        // page per column (~1.2 s on a 60-column file) and it runs on the same thread as
        // React; starting it in the same tick as the visible page made a cache hit take
        // 1.7 s instead of 0.5 s. Idle time is the right place for it.
        cancelPrefetch = schedulePrefetch(() => {
          if (!controller.signal.aborted) session.prefetch(page + 1);
        });
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        setPageLoading(false);
        setError(e instanceof Error ? e.message : "Failed to read rows");
      });
    return () => {
      controller.abort();
      cancelPrefetch?.();
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
      setTableBodyWidth(element.clientWidth);
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
      goToPage(Math.floor(row / PAGE_SIZE));
      setTargetRow(row);
    },
    [rowJump, goToPage, message],
  );

  // Bring the jumped-to row into view once its page has rendered; without this the right page
  // loads but the target row can sit below the fold and the user hunts for it. With a virtual
  // table the row may not be in the DOM at all, so the scroller is asked instead of the DOM.
  useEffect(() => {
    if (targetRow == null) return;
    const index = targetRow - page * PAGE_SIZE;
    if (index < 0 || index >= pageRows.length) return;
    tableRef.current?.scrollTo({ index });
  }, [targetRow, page, pageRows]);

  const rowRange = useMemo(() => {
    if (!fileInfo) return "";
    if (fileInfo.rowCount === 0) return $t("parquet.noRows");
    const start = page * PAGE_SIZE + 1;
    const end = Math.min(fileInfo.rowCount, (page + 1) * PAGE_SIZE);
    return `${start.toLocaleString()}–${end.toLocaleString()} of ${fileInfo.rowCount.toLocaleString()}`;
  }, [fileInfo, page]);

  const runSearch = useCallback(async () => {
    const info = fileInfoRef.current;
    const needle = query.trim().toLowerCase();
    const seq = ++searchSeq.current;
    setMatchRows(new Set());
    setSearchCapped(false);
    if (!info || !needle) {
      setSearching(false);
      setSearchProgress(null);
      return;
    }
    setSearching(true);
    setSearchedEmpty(false);
    setSearchProgress({ scanned: 0, total: info.rowCount, matches: 0 });
    try {
      // One page-aligned pass over the file, column by column, instead of a read per
      // 5000-row batch: without an offset index every batch re-decoded the data page that
      // contained it, which made a 1M-row file take ~28 s. See parquetSearch.ts.
      const result = await searchParquetValues(info, needle, {
        maxRows: SEARCH_MAX_ROWS,
        isCancelled: () => seq !== searchSeq.current,
        onProgress: (scanned, matches) => {
          if (seq === searchSeq.current)
            setSearchProgress({ scanned, total: info.rowCount, matches });
        },
      });
      if (seq !== searchSeq.current || result.cancelled) return;
      setMatchRows(new Set(result.rows));
      setSearchCapped(result.capped);
      setSearchedEmpty(result.rows.length === 0);
      matchColumnsRef.current = new Map(
        result.rows.map((row, at) => [row, result.columns[at] ?? 0] as const),
      );
      if (result.rows.length > 0) {
        const target = Math.floor(result.rows[0] / PAGE_SIZE);
        goToPage((current) => (current === target ? current : target));
        // A hit is a cell, not a row: bring its column into view too. `mark` stays false so
        // the tint keeps meaning "you clicked a schema field", not "a search ran".
        focusColumn(result.columns[0] ?? 0, false);
      }
    } catch (e) {
      if (seq === searchSeq.current) setError(e instanceof Error ? e.message : "Search failed");
    } finally {
      if (seq === searchSeq.current) setSearching(false);
    }
  }, [query, goToPage, focusColumn]);

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
      const column = matchColumnsRef.current.get(target);
      if (column !== undefined) focusColumn(column, false);
    },
    [matchRows, page, goToPage, focusColumn],
  );

  // clearing the box drops the previous results
  const resetSearch = useCallback(() => {
    searchSeq.current++;
    setSearching(false);
    setSearchProgress(null);
    setSearchCapped(false);
    setMatchRows(new Set());
    setSearchedEmpty(false);
    matchColumnsRef.current = new Map();
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

  const tableColumns = useMemo<ColumnsType<TableRow>>(() => {
    if (!fileInfo) return [];
    const cols: ColumnsType<TableRow> = [
      {
        title: "#",
        key: "__index",
        width: INDEX_COLUMN_WIDTH,
        align: "center",
        fixed: "left",
        className: "parquet-viewer__index-cell",
        onCell: () => ({ role: "rowheader", "aria-colindex": 1 }),
        onHeaderCell: () => ({ role: "columnheader", "aria-colindex": 1 }),
        render: (_value, _row, index) => page * PAGE_SIZE + index + 1,
      },
    ];
    fileInfo.columns.forEach((column, position) => {
      const kind = column.category;
      const active = activeColumn === position;
      cols.push({
        title: column.name,
        dataIndex: column.name,
        key: column.name,
        ellipsis: true,
        width: DATA_COLUMN_WIDTH,
        align: kind === "numeric" ? "right" : "left",
        className: active ? "parquet-viewer__column--active" : undefined,
        // A grid whose header and body are separate scroll surfaces has to state the column
        // ordinal on both sides: assistive tech maps a cell to its header by `aria-colindex`,
        // and the header itself needs the matching number.
        onHeaderCell: () => ({ role: "columnheader", "aria-colindex": position + 2 }),
        onCell: () => ({ role: "gridcell", "aria-colindex": position + 2 }),
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
                setActiveColumn(position);
                setInspected({ row: rowIndex, column: column.name, value });
              }}
            />
          );
        },
      });
    });
    return cols;
  }, [fileInfo, page, query, selectCell, activeColumn]);

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

    return () => {
      handler.off("open");
    };
  }, [loadParquet]);

  const inspectedType = inspected
    ? fileInfo?.columns.find((column) => column.name === inspected.column)?.type
    : undefined;
  const inspectedText = inspected
    ? inspected.value === null || inspected.value === undefined
      ? $t("parquet.nullLabel")
      : formatCellValue(inspected.value, inspectedType)
    : "";

  /**
   * Assistive tech hears the selection once it settles. The visible bar updates on every arrow
   * key, and an `aria-live` region on it queued one announcement per keystroke — ten moves,
   * ten messages.
   */
  const [announcement, setAnnouncement] = useState("");
  useEffect(() => {
    if (!inspected) return;
    const timer = window.setTimeout(() => {
      setAnnouncement(`${inspected.column} · row ${inspected.row + 1} · ${inspectedText}`);
    }, ANNOUNCE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [inspected, inspectedText]);

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
        <div className="parquet-viewer__too-large">
          <div className="parquet-viewer__too-large-panel">
            <h2 className="parquet-viewer__too-large-title">{$t("previewGuard.title")}</h2>
            <p className="parquet-viewer__too-large-body">
              {$t("previewGuard.body", {
                file: tooLarge.name,
                size: formatBytes(tooLarge.size),
                limit: formatBytes(previewLimitBytes(tooLarge.ext)),
              })}
            </p>
            <button
              type="button"
              className="parquet-viewer__pager-btn parquet-viewer__too-large-open"
              onClick={handleOpenAnyway}
            >
              {$t("previewGuard.open")}
            </button>
          </div>
        </div>
      )}
      {loading && (
        <div className="parquet-viewer__overlay">
          <span className="codicon codicon-loading codicon-modifier-spin" />
          <span>{$t("parquet.loading")}</span>
        </div>
      )}
      {failure ? (
        <div className="parquet-viewer__error-pane">
          {fileName && (
            <div className="parquet-viewer__error-file">
              <span className="codicon codicon-file" />
              <span className="parquet-viewer__error-file-name">{fileName}</span>
            </div>
          )}
          <div className="parquet-viewer__error" role="alert">
            <span className="codicon codicon-error" />
            <div className="parquet-viewer__error-body">
              <p className="parquet-viewer__error-title">
                {failure.kind === "other" ? failure.raw : $t("parquet.errorTitle")}
              </p>
              {failure.kind !== "other" && (
                <p className="parquet-viewer__error-text">
                  {failure.kind === "codec"
                    ? $t("parquet.errorCodec", { codec: failure.codec })
                    : $t("parquet.errorTruncated")}
                </p>
              )}
              {failure.kind !== "other" && (
                <details className="parquet-viewer__error-raw">
                  <summary>{$t("parquet.errorDetail")}</summary>
                  <pre>{failure.raw}</pre>
                </details>
              )}
            </div>
            <div className="parquet-viewer__error-actions">
              <button
                type="button"
                className="parquet-viewer__pager-btn parquet-viewer__pager-btn--text"
                onClick={() => handler.emit("init")}
              >
                {$t("common.retry")}
              </button>
              <button
                type="button"
                className="parquet-viewer__pager-btn"
                onClick={() => handler.emit("editInVSCode", true)}
              >
                {$t("common.editInVscode")}
              </button>
            </div>
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
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  // Enter follows VS Code's own find: move to the next hit. Re-running a
                  // whole-file scan (1.3 s on a million rows) belongs on the button and on
                  // Ctrl/Cmd+Enter, not on the key the user presses to walk the matches.
                  if (event.ctrlKey || event.metaKey) void runSearch();
                  else if (matchRows.size > 0) jumpMatch(event.shiftKey ? -1 : 1);
                  else void runSearch();
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
                  className={`codicon ${searching ? "codicon-loading codicon-modifier-spin" : "codicon-refresh"}`}
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
              {!searching && searchedEmpty && (
                <span className="parquet-viewer__find-count">
                  {$t("parquet.matchCountMany", { count: "0" })}
                </span>
              )}
            </div>
            <div className="parquet-viewer__meta">
              <span className="parquet-viewer__meta-item" title={$t("parquet.rows")}>
                <span className="codicon codicon-list-flat parquet-icon parquet-icon--rows" />
                <span className="parquet-viewer__meta-value">
                  {fileInfo.rowCount.toLocaleString()}
                </span>
                <span className="parquet-viewer__meta-label">
                  {fileInfo.rowCount === 1 ? $t("parquet.rowOne") : $t("parquet.rows")}
                </span>
              </span>
              <span className="parquet-viewer__meta-item" title={$t("parquet.columnsLabel")}>
                <span className="codicon codicon-symbol-field parquet-icon parquet-icon--columns" />
                <span className="parquet-viewer__meta-value">{fileInfo.columns.length}</span>
                <span className="parquet-viewer__meta-label">
                  {fileInfo.columns.length === 1
                    ? $t("parquet.columnOne")
                    : $t("parquet.columnsLabel")}
                </span>
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
                {fileInfo.columns.map((column, position) => {
                  const icon = COLUMN_ICONS[column.category];
                  const kind = column.category;
                  const active = activeColumn === position;
                  return (
                    <button
                      key={column.name}
                      type="button"
                      className={`parquet-viewer__list-item${active ? " parquet-viewer__list-item--active" : ""}`}
                      aria-pressed={active}
                      aria-label={`Jump to column ${column.name}`}
                      title={`Jump to ${column.name}`}
                      onClick={() => focusColumn(position)}
                    >
                      <span
                        className={`codicon parquet-viewer__list-icon parquet-viewer__list-icon--${kind} ${icon}`}
                      />
                      <span className="parquet-viewer__list-name" title={column.name}>
                        {column.name}
                      </span>
                      <span className="parquet-viewer__list-type" title={column.type}>
                        {column.type}
                      </span>
                    </button>
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
                >
                  <CursorContext.Provider value={cursor}>
                    <Table<TableRow>
                      ref={tableRef}
                      virtual
                      className="parquet-table"
                      dataSource={tableRows}
                      columns={tableColumns}
                      locale={{ emptyText: $t("parquet.noRows") }}
                      pagination={false}
                      size="small"
                      scroll={{
                        // Virtual scrolling needs numbers: x is the full column extent (or the
                        // viewport when it is wider), y is the body height measured above.
                        x: Math.max(tableBodyWidth, 64 + (fileInfo.columns.length + 1) * 120),
                        y: tableBodyHeight,
                      }}
                      rowClassName={(_row, index) => {
                        const absolute = page * PAGE_SIZE + index;
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
                        "aria-rowindex": page * PAGE_SIZE + (index ?? 0) + 1,
                      })}
                      components={{
                        table: PresentationTable,
                        header: { table: PresentationTable },
                      }}
                    />
                  </CursorContext.Provider>
                </div>
              )}
            </main>
          </div>
          <footer className="parquet-viewer__bottombar">
            {/* One announcement per settled selection. The visible bar updates on every arrow
                key, and aria-live on it queued a message per keystroke. */}
            <span className="parquet-viewer__sr-only" role="status" aria-live="polite">
              {inspected ? announcement : ""}
            </span>
            <div className="parquet-viewer__selection">
              {fileInfo.rowCount === 0 ? null : inspected ? (
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
                      void navigator.clipboard.writeText(inspectedText).catch(() => undefined);
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
                disabled={fileInfo.rowCount === 0}
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
                disabled={fileInfo.rowCount === 0}
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
        <ParquetViewer dark={dark} />
      </App>
    </ConfigProvider>
  );
}
