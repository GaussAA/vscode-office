import { useCallback, useEffect, useRef, useState } from "react";
import type { ParquetFileInfo } from "@/common/parquetReader";
import type { ParquetSearchData, ParquetSearchProgress } from "@/common/parquetSearchTypes";
import type { ParquetSession } from "./parquetSession";
import { ParquetHitSet, normalizeSearchQuery } from "./parquetHitSet";

export type ParquetSearchScope = "all" | "active" | "visible";

interface UseParquetSearchArgs {
  fileInfoRef: React.RefObject<ParquetFileInfo | null>;
  sessionRef: React.RefObject<ParquetSession | null>;
  page: number;
  goToPage: (next: number | ((current: number) => number)) => void;
  focusColumn: (position: number, mark?: boolean, preserveActive?: boolean) => void;
  onError: (message: string) => void;
  onSearched?: (matches: number) => void;
  /** Scope and the geometry the host needs to turn it into column positions. */
  scope: ParquetSearchScope;
  activeColumn: number | null;
  visibleColumns: number[];
  requestSearch: (request: { requestId: number; query: string; columns?: number[] }) => void;
  cancelHostSearch: (requestId: number) => void;
}

export interface ParquetSearch {
  query: string;
  searching: boolean;
  progress: { scanned: number; total: number; matches: number } | null;
  matchRows: Set<number>;
  /** Distinct columns that matched at least one row; the UI tints all of them. */
  matchedColumns: Set<number>;
  activeMatch: number | null;
  capped: boolean;
  searchedEmpty: boolean;
  hasCurrentResults: boolean;
  runSearch: () => Promise<void>;
  jumpMatch: (direction: 1 | -1) => void;
  cancelSearch: () => void;
  resetSearch: (clearQuery?: boolean) => void;
  handleQueryChange: (next: string) => void;
  handleSearchProgress: (payload: ParquetSearchProgress) => void;
  handleSearchData: (payload: ParquetSearchData) => void;
}

/**
 * Whole-file search state.
 *
 * The scan itself runs in the extension host (ADR-0031): this hook owns the query, the scope
 * choice, the in-flight request identity and the hit set, and turns host replies into the same
 * navigation the webview scan used to drive. A search is one request; cancellation is a second
 * message with the same request id.
 */
export function useParquetSearch({
  fileInfoRef,
  sessionRef,
  page,
  goToPage,
  focusColumn,
  onError,
  onSearched,
  scope,
  activeColumn,
  visibleColumns,
  requestSearch,
  cancelHostSearch,
}: UseParquetSearchArgs): ParquetSearch {
  const onSearchedRef = useRef(onSearched);

  useEffect(() => {
    onSearchedRef.current = onSearched;
  }, [onSearched]);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [progress, setProgress] = useState<{
    scanned: number;
    total: number;
    matches: number;
  } | null>(null);
  const [matchRows, setMatchRows] = useState<Set<number>>(() => new Set());
  const [matchedColumns, setMatchedColumns] = useState<Set<number>>(() => new Set());
  const [activeMatch, setActiveMatch] = useState<number | null>(null);
  const [capped, setCapped] = useState(false);
  const [searchedEmpty, setSearchedEmpty] = useState(false);
  const [searchedQuery, setSearchedQuery] = useState("");
  const lastRequestId = useRef(0);
  const hitSetRef = useRef<ParquetHitSet | null>(null);
  // The host needs the scope that produced the request; a later scope change must not relabel
  // a result that is still on screen.
  const requestScope = useRef<ParquetSearchScope>("all");

  const resetSearch = useCallback(
    (clearQuery = false) => {
      // A running host scan has no reader after this reset; cancel it and bump the id so a
      // late reply cannot repopulate results for a query that is no longer on screen.
      if (lastRequestId.current > 0) cancelHostSearch(lastRequestId.current);
      lastRequestId.current += 1;
      setSearchedQuery("");
      setSearching(false);
      setProgress(null);
      setCapped(false);
      setMatchRows(new Set());
      setMatchedColumns(new Set());
      setSearchedEmpty(false);
      setActiveMatch(null);
      hitSetRef.current = null;
      if (clearQuery) setQuery("");
    },
    [cancelHostSearch],
  );

  /** Show a finished result: same path for a fresh scan and any future host memo hit. */
  const applyHitSet = useCallback(
    (hitSet: ParquetHitSet, nextCapped: boolean, columns: readonly number[]) => {
      hitSetRef.current = hitSet;
      setMatchRows(hitSet.rowSet);
      setMatchedColumns(new Set(columns));
      setCapped(nextCapped);
      setSearchedEmpty(hitSet.isEmpty);
      onSearchedRef.current?.(hitSet.size);
      if (hitSet.isEmpty) {
        setActiveMatch(null);
        return;
      }
      setActiveMatch(0);
      const first = hitSet.at(0);
      if (!first) return;
      const target = sessionRef.current?.rowToPage(first.row);
      if (target !== undefined) goToPage((current) => (current === target ? current : target));
      // A hit is a cell, not a row: bring its column into view too. The tint stays off for a
      // default search so it keeps meaning "you picked a schema field"; when the user is
      // searching the active column, the tint has to stay so the scope selector still has a
      // target for the next search.
      focusColumn(first.column, false, requestScope.current === "active");
    },
    [focusColumn, goToPage, sessionRef],
  );

  const runSearch = useCallback(async () => {
    const info = fileInfoRef.current;
    const text = query.trim();
    const needle = normalizeSearchQuery(query);
    setMatchRows(new Set());
    setMatchedColumns(new Set());
    setCapped(false);
    if (!info || !needle) {
      setSearching(false);
      setProgress(null);
      return;
    }

    let columns: number[] | undefined;
    if (scope === "active") {
      if (activeColumn === null) {
        // The disabled option is the normal guard; a persisted scope can still lose its
        // column when the field is hidden. Do not turn that into the viewer's global error
        // pane — the user only has to pick a scope.
        setSearching(false);
        setProgress(null);
        return;
      }
      columns = [activeColumn];
    } else if (scope === "visible") {
      if (visibleColumns.length === 0) return;
      columns = [...visibleColumns];
    }

    // The results belong to this text and this scope. Remembering both is what lets Enter
    // tell "walk the hits I already have" from "this is a new needle, search it".
    requestScope.current = scope;
    setSearchedQuery(needle);
    setSearchedEmpty(false);
    const requestId = ++lastRequestId.current;
    setSearching(true);
    setProgress({ scanned: 0, total: info.rowCount, matches: 0 });
    requestSearch({ requestId, query: text, ...(columns ? { columns } : {}) });
  }, [activeColumn, fileInfoRef, query, requestSearch, scope, visibleColumns]);

  const handleSearchProgress = useCallback((payload: ParquetSearchProgress) => {
    if (payload.requestId !== lastRequestId.current) return;
    setProgress({
      scanned: payload.scanned,
      total: payload.total,
      matches: payload.matches,
    });
  }, []);

  const handleSearchData = useCallback(
    (payload: ParquetSearchData) => {
      if (payload.requestId !== lastRequestId.current) return;
      setSearching(false);
      setProgress(null);
      if (payload.error) {
        onError(payload.error);
        setSearchedEmpty(false);
        return;
      }
      if (payload.cancelled || payload.rows === null) return;
      setSearchedEmpty(payload.rows.length === 0);
      const hitSet = new ParquetHitSet(payload.rows, payload.columns, searchedQuery);
      applyHitSet(hitSet, payload.capped, payload.columns);
    },
    [applyHitSet, onError, searchedQuery],
  );

  const jumpMatch = useCallback(
    (direction: 1 | -1) => {
      const session = sessionRef.current;
      const hitSet = hitSetRef.current;
      if (!session || !hitSet || hitSet.isEmpty) return;
      const match = hitSet.step(direction, page, session);
      if (!match) return;
      goToPage(session.rowToPage(match.row));
      setActiveMatch(match.index);
      focusColumn(match.column, false, requestScope.current === "active");
    },
    [focusColumn, goToPage, page, sessionRef],
  );

  /** Abandon a running scan. The host checks the token between pages and stops decoding. */
  const cancelSearch = useCallback(() => {
    cancelHostSearch(lastRequestId.current);
    // A reply for the cancelled id must be ignored, not painted after the user stopped it.
    lastRequestId.current += 1;
    setSearching(false);
    setProgress(null);
  }, [cancelHostSearch]);

  const handleQueryChange = useCallback(
    (next: string) => {
      setQuery(next);
      if (normalizeSearchQuery(next) !== searchedQuery) resetSearch();
    },
    [resetSearch, searchedQuery],
  );

  return {
    query,
    searching,
    progress,
    matchRows,
    matchedColumns,
    activeMatch,
    capped,
    searchedEmpty,
    hasCurrentResults: matchRows.size > 0 && normalizeSearchQuery(query) === searchedQuery,
    runSearch,
    jumpMatch,
    cancelSearch,
    resetSearch,
    handleQueryChange,
    handleSearchProgress,
    handleSearchData,
  };
}
