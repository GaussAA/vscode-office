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
/** Must agree with `.parquet-viewer__cell` in the stylesheet: 6px padding ×2 + 22px line-height. */
const ROW_HEIGHT = 34;

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
        // Opening the link is the point of the click, but it must not be the *only* thing that
        // happens: without this the one value a reader most wants to copy was the only one the
        // inspector could never hold.
        onActivate();
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
  /** Position of the currently shown hit inside the sorted match list; null before any jump. */
  const [activeMatch, setActiveMatch] = useState<number | null>(null);
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
  /** Where the cursor should land once a page turned by keyboard has loaded. */
  const pendingCursor = useRef<{ where: "first" | "last"; col: number } | null>(null);
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
  /** The needle the current results belong to; empty when there are none to trust. */
  const searchedQuery = useRef("");

  // Keep the cursor in a ref as well as state: several keydowns can arrive before React
  // re-renders, and each one must move from the position the previous one reached.
  const selectCell = useCallback((next: CellCursor | null) => {
    cursorRef.current = next;
    setCursor(next);
  }, []);

  /**
   * Bring one field into view without changing the page or the row selection.
   *
   * The target is *measured*, not computed from the column width: when a file has fewer columns
   * than fit the viewport, antd stretches them to fill it, so `64 + n × 120` only holds once the
   * table actually overflows. The measured cell decides both whether scrolling is needed and how
   * far to go.
   */
  const focusColumn = useCallback((position: number, mark = true) => {
    if (mark) setActiveColumn(position);
    const colIndex = position + 2;

    const bodyOffset = (): number => {
      const wrap = tableWrapRef.current;
      if (!wrap) return 0;
      const inner = wrap.querySelector<HTMLElement>(".ant-table-tbody-virtual-holder-inner");
      if (inner) return wrap.getBoundingClientRect().left - inner.getBoundingClientRect().left;
      const body = wrap.querySelector<HTMLElement>(".ant-table-body, .ant-table-content");
      return body?.scrollLeft ?? 0;
    };

    /**
     * The header is a separate scroll surface. rc-virtual-list moves the body by transform, so
     * nothing fires the scroll event that normally keeps the two in step.
     */
    const syncHeader = () => {
      const header = tableWrapRef.current?.querySelector<HTMLElement>(".ant-table-header");
      if (!header) return;
      const offset = bodyOffset();
      if (Math.abs(header.scrollLeft - offset) > 1) header.scrollLeft = offset;
    };

    const isSettled = (): boolean => {
      const wrap = tableWrapRef.current;
      const cell = wrap?.querySelector<HTMLElement>(
        `[role="gridcell"][aria-colindex="${colIndex}"]`,
      );
      if (!wrap || !cell) return false;
      const wrapRect = wrap.getBoundingClientRect();
      const rect = cell.getBoundingClientRect();
      const centred =
        Math.abs(wrapRect.left + Math.max(0, (wrapRect.width - rect.width) / 2) - rect.left) < 2;
      const header = wrap.querySelector<HTMLElement>(
        `.ant-table-header th[aria-colindex="${colIndex}"]`,
      );
      const aligned = !header || Math.abs(header.getBoundingClientRect().left - rect.left) < 2;
      return centred && aligned;
    };

    const scrollOnce = () => {
      const wrap = tableWrapRef.current;
      if (!wrap) return;
      const wrapRect = wrap.getBoundingClientRect();
      // The header renders every column (it is not virtualised), so it is the reliable count.
      const headerCols = wrap.querySelectorAll(".ant-table-header th[aria-colindex]").length;
      const columnCount =
        headerCols > 0 ? headerCols - 1 : (fileInfoRef.current?.columns.length ?? 0);
      const contentWidth =
        columnCount > 0
          ? INDEX_COLUMN_WIDTH + (columnCount + 1) * DATA_COLUMN_WIDTH
          : (wrap.querySelector<HTMLElement>(".ant-table-tbody-virtual-holder-inner")
              ?.scrollWidth ?? 0);
      const maxScroll = Math.max(0, contentWidth - wrapRect.width);
      if (maxScroll <= 0) {
        syncHeader();
        return;
      }

      // An off-screen column is not rendered at all, so there is nothing to measure: fall back to
      // the layout arithmetic, then let the verification pass correct any drift now that the
      // column exists in the DOM.
      const cell = wrap.querySelector<HTMLElement>(
        `[role="gridcell"][aria-colindex="${colIndex}"]`,
      );
      const desired = cell
        ? (() => {
            const rect = cell.getBoundingClientRect();
            const centred = wrapRect.left + Math.max(0, (wrapRect.width - rect.width) / 2);
            // Increasing the offset moves the content left, so the offset we want is the current
            // one plus however far the cell still has to travel left.
            return bodyOffset() + (rect.left - centred);
          })()
        : INDEX_COLUMN_WIDTH +
          position * DATA_COLUMN_WIDTH -
          Math.max(0, (wrapRect.width - DATA_COLUMN_WIDTH) / 2);
      const target = Math.max(0, Math.min(maxScroll, desired));

      // Drag the thumb rather than clicking the track: rc-virtual-list ignores a mousedown whose
      // target is the thumb, and with a wide thumb the track position that would mean "the end"
      // lands inside the thumb itself. A drag is relative, so it works at any thumb size.
      const track = wrap.querySelector<HTMLElement>(
        ".ant-table-tbody-virtual-scrollbar-horizontal",
      );
      const thumb = track?.querySelector<HTMLElement>(".ant-table-tbody-virtual-scrollbar-thumb");
      if (track && thumb) {
        const trackRect = track.getBoundingClientRect();
        const thumbRect = thumb.getBoundingClientRect();
        const offsetRange = trackRect.width - thumbRect.width;
        if (offsetRange > 0 && thumbRect.width > 0) {
          const px = ((target - bodyOffset()) / maxScroll) * offsetRange;
          if (Math.abs(px) < 0.5) {
            syncHeader();
            return;
          }
          const startX = thumbRect.left + thumbRect.width / 2;
          const startY = trackRect.top + trackRect.height / 2;
          // The drag handler reads `pageX`, which a synthetic MouseEvent does not reliably carry
          // (only `clientX` is part of MouseEventInit), so define it explicitly.
          const fire = (node: EventTarget, type: string, x: number, init: MouseEventInit = {}) => {
            const event = new MouseEvent(type, {
              bubbles: true,
              cancelable: true,
              clientX: x,
              clientY: startY,
              ...init,
            });
            Object.defineProperty(event, "pageX", { value: x });
            Object.defineProperty(event, "pageY", { value: startY });
            node.dispatchEvent(event);
          };
          fire(thumb, "mousedown", startX, { button: 0, buttons: 1 });
          // The window listeners only exist after React commits `dragging` (post-paint), and the
          // scroll is applied on the frame after the move — releasing in the same tick cancels it,
          // because the drag effect cleans up with `raf.cancel`.
          window.setTimeout(() => {
            fire(window, "mousemove", startX + px * 0.5, { buttons: 1 });
            fire(window, "mousemove", startX + px, { buttons: 1 });
            window.setTimeout(() => {
              fire(window, "mouseup", startX + px, { buttons: 0 });
              window.setTimeout(() => syncHeader(), 32);
            }, 64);
          }, 80);
          return;
        }
      }

      const body = wrap.querySelector<HTMLElement>(".ant-table-body, .ant-table-content");
      if (body && Math.abs(target - body.scrollLeft) >= 1) {
        const behavior = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth";
        body.scrollTo({ left: target, behavior });
      }
      syncHeader();
    };

    // Let the active column commit, then verify and retry: the virtual table rebuilds its
    // scrollbar when a column class changes, so an attempt can land on a detached track or on one
    // whose geometry is still zero. Both are silent.
    requestAnimationFrame(() => {
      let tries = 8;
      const attempt = () => {
        scrollOnce();
        requestAnimationFrame(() => {
          syncHeader();
          if (isSettled() || --tries <= 0) return;
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
    // The results belong to this text. Remembering it is what lets Enter tell "walk the hits I
    // already have" from "this is a new needle, search it".
    searchedQuery.current = needle;
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
        setActiveMatch(0);
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
      setActiveMatch(sorted.indexOf(target));
      const column = matchColumnsRef.current.get(target);
      if (column !== undefined) focusColumn(column, false);
    },
    [matchRows, page, goToPage, focusColumn],
  );

  /** Abandon a running scan. The scan checks `searchSeq` between pages, so this stops it. */
  const cancelSearch = useCallback(() => {
    searchSeq.current++;
    setSearching(false);
    setSearchProgress(null);
  }, []);

  // Clearing the box drops the previous results — and so does editing it: a result set that no
  // longer matches the text in the box is a lie that Enter would act on.
  const resetSearch = useCallback(() => {
    searchSeq.current++;
    searchedQuery.current = "";
    setSearching(false);
    setSearchProgress(null);
    setSearchCapped(false);
    setMatchRows(new Set());
    setSearchedEmpty(false);
    setActiveMatch(null);
    matchColumnsRef.current = new Map();
  }, []);

  const handleQueryChange = useCallback(
    (next: string) => {
      setQuery(next);
      if (next.trim().toLowerCase() !== searchedQuery.current) resetSearch();
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
      const pageCount = Math.max(1, Math.ceil(fileInfo.rowCount / PAGE_SIZE));
      const base = cursorRef.current ?? { row: 0, col: 0 };

      /**
       * Turn the page and land the cursor on the edge of the new one. The column is kept: a
       * comparison across pages should not have to be re-navigated. The row is applied once the
       * new page's rows exist, because `goToPage` clears the cursor on purpose.
       */
      const turnPage = (nextPage: number, where: "first" | "last"): boolean => {
        const targetPage = Math.max(0, Math.min(pageCount - 1, nextPage));
        if (targetPage === page) return false;
        pendingCursor.current = { where, col: base.col };
        goToPage(targetPage);
        return true;
      };

      if ((event.ctrlKey || event.metaKey) && (event.key === "Home" || event.key === "End")) {
        event.preventDefault();
        turnPage(event.key === "Home" ? 0 : pageCount - 1, event.key === "Home" ? "first" : "last");
        return;
      }
      // Page-sized jumps take the rows you can actually see, not the page size: PAGE_SIZE is 50
      // and the body shows about 22, so a page-sized step skipped a third of the data unseen.
      const visibleRows = Math.max(1, Math.floor(tableBodyHeight / ROW_HEIGHT));
      if (event.key === "PageDown") {
        event.preventDefault();
        if (base.row + visibleRows <= rows - 1)
          selectCell({ row: base.row + visibleRows, col: base.col });
        else turnPage(page + 1, "first");
        return;
      }
      if (event.key === "PageUp") {
        event.preventDefault();
        if (base.row - visibleRows >= 0) selectCell({ row: base.row - visibleRows, col: base.col });
        else turnPage(page - 1, "last");
        return;
      }
      // Arrows walk off the end of a page into the next one instead of stopping dead: 50 rows is
      // not a file, and a virtual table cannot be scrolled with the keyboard otherwise.
      if (event.key === "ArrowDown" && cursor && cursor.row >= rows - 1) {
        event.preventDefault();
        turnPage(page + 1, "first");
        return;
      }
      if (event.key === "ArrowUp" && cursor && cursor.row === 0) {
        event.preventDefault();
        turnPage(page - 1, "last");
        return;
      }

      // The first arrow lands on the first cell: without this, Down starts at row 1 and Up at
      // row -1 (clamped to 0), so the top-left cell could never be reached from a cold start.
      if (!cursorRef.current) {
        event.preventDefault();
        selectCell({ row: 0, col: 0 });
        return;
      }

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
    [cursor, fileInfo, page, pageRows, selectCell, goToPage, tableBodyHeight],
  );

  // A page turned from the keyboard has to put the cursor back: `goToPage` clears it, and the
  // row it should land on ("last" = the previous page's final row) is only known once the new
  // page's rows have arrived.
  useEffect(() => {
    const pending = pendingCursor.current;
    if (!pending || pageRows.length === 0) return;
    pendingCursor.current = null;
    selectCell({ row: pending.where === "first" ? 0 : pageRows.length - 1, col: pending.col });
  }, [pageRows, selectCell]);

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
  const inspectedFull = inspected
    ? inspected.value === null || inspected.value === undefined
      ? $t("parquet.nullLabel")
      : formatCellValue(inspected.value, inspectedType)
    : "";
  /**
   * Containers are previewed, never dumped: `formatCellValue` has no length cap, so selecting a
   * 5000-element LIST used to stringify the whole thing into state (and into the title) on every
   * arrow key. Copy still gets the full value.
   */
  const inspectedText =
    inspected && inspected.value !== null && typeof inspected.value === "object"
      ? jsonPreviewText(inspected.value)
      : inspectedFull;

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
                onClick={() => handler.emit("revealFile")}
              >
                {$t("parquet.revealFile")}
              </button>
              <button
                type="button"
                className="parquet-viewer__pager-btn"
                onClick={() => handler.emit("init")}
              >
                {$t("common.retry")}
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
                  else if (
                    matchRows.size > 0 &&
                    query.trim().toLowerCase() === searchedQuery.current
                  )
                    jumpMatch(event.shiftKey ? -1 : 1);
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
                onClick={() => (searching ? cancelSearch() : void runSearch())}
                title={searching ? $t("parquet.stopSearch") : $t("parquet.searchAllRows")}
                aria-label={searching ? $t("parquet.stopSearch") : $t("parquet.searchAllRows")}
              >
                <span className={`codicon ${searching ? "codicon-stop-circle" : "codicon-run"}`} />
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
              {!searching && query.trim() !== "" && matchRows.size === 0 && !searchedEmpty && (
                <span className="parquet-viewer__find-count">{$t("parquet.searchHint")}</span>
              )}
              {!searching && matchRows.size > 0 && (
                <>
                  <span className="parquet-viewer__find-count">
                    {$t("parquet.matchPosition", {
                      index: (activeMatch ?? 0) + 1,
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
              {codecs.length > 0 && (
                <span className="parquet-viewer__meta-item" title={$t("parquet.codec")}>
                  <span className="codicon codicon-file-zip parquet-icon parquet-icon--codec" />
                  <span className="parquet-viewer__meta-value">{codecs.join(" · ")}</span>
                  <span className="parquet-viewer__meta-label">{$t("parquet.codec")}</span>
                </span>
              )}
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
                  <span className="parquet-viewer__selection-value" title={inspectedFull}>
                    {inspectedText}
                  </span>
                  <button
                    type="button"
                    className="parquet-viewer__pager-btn"
                    onClick={() => {
                      void navigator.clipboard.writeText(inspectedFull).catch(() => undefined);
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
                onClick={() => goToPage(0)}
                title={$t("parquet.firstPage")}
                aria-label={$t("parquet.firstPage")}
              >
                <span className="codicon codicon-arrow-left" />
              </button>
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
              <button
                type="button"
                className="parquet-viewer__pager-btn"
                disabled={page >= totalPages - 1}
                onClick={() => goToPage(totalPages - 1)}
                title={$t("parquet.lastPage")}
                aria-label={$t("parquet.lastPage")}
              >
                <span className="codicon codicon-arrow-right" />
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
