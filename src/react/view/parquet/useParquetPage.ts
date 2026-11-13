import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { ParquetFileInfo } from "./parquetParser";
import { savePersistedRow } from "./parquetPersistence";
import type { ParquetSession } from "./parquetSession";

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

interface UseParquetPageArgs {
  fileInfo: ParquetFileInfo | null;
  page: number;
  reloadToken: number;
  sessionRef: RefObject<ParquetSession | null>;
  documentKeyRef: RefObject<string | undefined>;
  restoreRowRef: RefObject<number>;
  restorePendingRef: RefObject<boolean>;
  loadedStartRef: RefObject<number>;
  onError: (message: string) => void;
  /**
   * Fires once per loaded page with the row the page starts at. Announcements hang off this
   * rather than off `loadedStart` in an effect: the callback has an event behind it, and it says
   * "rows actually arrived", which is the moment worth speaking.
   */
  onPageLoaded?: (start: number, loaded: number) => void;
}

/**
 * The loaded page, its row origin and the wire to `ParquetSession`. Row identity must come from
 * `loadedStart`, not `page * pageSize`: a page click changes the label immediately, but the rows
 * arrive later, and every row number in between would be a lie.
 */
export function useParquetPage({
  fileInfo,
  page,
  reloadToken,
  sessionRef,
  documentKeyRef,
  restoreRowRef,
  restorePendingRef,
  loadedStartRef,
  onError,
  onPageLoaded,
}: UseParquetPageArgs) {
  const onLoadedRef = useRef(onPageLoaded);

  useEffect(() => {
    onLoadedRef.current = onPageLoaded;
  }, [onPageLoaded]);
  const [loadedPage, setLoadedPage] = useState(0);
  const [loadedStart, setLoadedStart] = useState(0);
  const [pageRows, setPageRows] = useState<Record<string, unknown>[]>([]);
  const [pageLoading, setPageLoading] = useState(false);

  const resetPage = useCallback(() => {
    loadedStartRef.current = 0;
    setPageRows([]);
    setLoadedPage(0);
    setLoadedStart(0);
    setPageLoading(false);
  }, [loadedStartRef]);

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
        loadedStartRef.current = snapshot.start;
        onLoadedRef.current?.(snapshot.start, snapshot.rows.length);
        if (snapshot.start === restoreRowRef.current) restorePendingRef.current = false;
        setPageLoading(false);
        // Prefetch only once this page is on screen. Idle time keeps a cache hit fast.
        cancelPrefetch = schedulePrefetch(() => {
          if (!controller.signal.aborted) session.prefetch(page + 1);
        });
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setPageLoading(false);
        onError(cause instanceof Error ? cause.message : "Failed to read rows");
      });
    return () => {
      controller.abort();
      cancelPrefetch?.();
    };
  }, [
    fileInfo,
    loadedStartRef,
    onError,
    page,
    reloadToken,
    restorePendingRef,
    restoreRowRef,
    sessionRef,
  ]);

  useEffect(() => {
    // Nothing to remember before the first page has actually arrived — and while a restore is
    // still pending, the page-0 load that wins the race must not write over the stored row.
    if (!fileInfo || pageRows.length === 0 || restorePendingRef.current) return;
    savePersistedRow(documentKeyRef.current, loadedStart);
  }, [documentKeyRef, fileInfo, loadedStart, pageRows.length, restorePendingRef]);

  return {
    pageRows,
    loadedPage,
    loadedStart,
    pageLoading,
    loadedStartRef,
    resetPage,
  };
}
