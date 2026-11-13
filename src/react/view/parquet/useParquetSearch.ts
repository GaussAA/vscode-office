import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { ParquetFileInfo } from "./parquetParser";
import { searchParquetValues } from "./parquetSearch";
import { SEARCH_MAX_ROWS } from "./parquetLayout";

interface UseParquetSearchArgs {
  fileInfoRef: RefObject<ParquetFileInfo | null>;
  page: number;
  pageSize: number;
  goToPage: (next: number | ((current: number) => number)) => void;
  focusColumn: (position: number, mark?: boolean) => void;
  onError: (message: string) => void;
  /**
   * Fires once per finished search with the number of matching rows. Announcing progress would
   * queue a message per scanned batch; the result is the thing worth saying out loud.
   */
  onSearched?: (matches: number) => void;
}

export interface ParquetSearch {
  query: string;
  searching: boolean;
  progress: { scanned: number; total: number; matches: number } | null;
  matchRows: Set<number>;
  activeMatch: number | null;
  capped: boolean;
  searchedEmpty: boolean;
  hasCurrentResults: boolean;
  runSearch: () => Promise<void>;
  jumpMatch: (direction: 1 | -1) => void;
  cancelSearch: () => void;
  resetSearch: (clearQuery?: boolean) => void;
  handleQueryChange: (next: string) => void;
}

/**
 * Whole-file search state. The viewer supplies navigation and error reporting; this module owns
 * the scan, cancellation, the result set and the "is this result for the text in the box" rule.
 */
export function useParquetSearch({
  fileInfoRef,
  page,
  pageSize,
  goToPage,
  focusColumn,
  onError,
  onSearched,
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
  const [activeMatch, setActiveMatch] = useState<number | null>(null);
  const [capped, setCapped] = useState(false);
  const [searchedEmpty, setSearchedEmpty] = useState(false);
  const [searchedQuery, setSearchedQuery] = useState("");
  const searchSeq = useRef(0);
  const matchColumnsRef = useRef<Map<number, number>>(new Map());

  const resetSearch = useCallback((clearQuery = false) => {
    searchSeq.current++;
    setSearchedQuery("");
    setSearching(false);
    setProgress(null);
    setCapped(false);
    setMatchRows(new Set());
    setSearchedEmpty(false);
    setActiveMatch(null);
    matchColumnsRef.current = new Map();
    if (clearQuery) setQuery("");
  }, []);

  const runSearch = useCallback(async () => {
    const info = fileInfoRef.current;
    const needle = query.trim().toLowerCase();
    const seq = ++searchSeq.current;
    setMatchRows(new Set());
    setCapped(false);
    if (!info || !needle) {
      setSearching(false);
      setProgress(null);
      return;
    }
    // The results belong to this text. Remembering it is what lets Enter tell "walk the hits I
    // already have" from "this is a new needle, search it".
    setSearchedQuery(needle);
    setSearching(true);
    setSearchedEmpty(false);
    setProgress({ scanned: 0, total: info.rowCount, matches: 0 });
    try {
      // One page-aligned pass over the file, column by column, instead of a read per
      // 5000-row batch: without an offset index every batch re-decoded the data page that
      // contained it, which made a 1M-row file take ~28 s. See parquetSearch.ts.
      const result = await searchParquetValues(info, needle, {
        maxRows: SEARCH_MAX_ROWS,
        isCancelled: () => seq !== searchSeq.current,
        onProgress: (scanned, matches) => {
          if (seq === searchSeq.current) {
            setProgress({ scanned, total: info.rowCount, matches });
          }
        },
      });
      if (seq !== searchSeq.current || result.cancelled) return;
      setMatchRows(new Set(result.rows));
      setCapped(result.capped);
      setSearchedEmpty(result.rows.length === 0);
      onSearchedRef.current?.(result.rows.length);
      matchColumnsRef.current = new Map(
        result.rows.map((row, at) => [row, result.columns[at] ?? 0] as const),
      );
      if (result.rows.length > 0) {
        setActiveMatch(0);
        const target = Math.floor(result.rows[0] / pageSize);
        goToPage((current) => (current === target ? current : target));
        // A hit is a cell, not a row: bring its column into view too. `mark` stays false so
        // the tint keeps meaning "you clicked a schema field", not "a search ran".
        focusColumn(result.columns[0] ?? 0, false);
      }
    } catch (e) {
      if (seq === searchSeq.current) onError(e instanceof Error ? e.message : "Search failed");
    } finally {
      if (seq === searchSeq.current) setSearching(false);
    }
  }, [fileInfoRef, focusColumn, goToPage, onError, pageSize, query]);

  const jumpMatch = useCallback(
    (direction: 1 | -1) => {
      if (matchRows.size === 0) return;
      const sorted = [...matchRows].sort((a, b) => a - b);
      const pageStart = page * pageSize;
      const pageEnd = pageStart + pageSize;
      const target =
        direction > 0
          ? (sorted.find((row) => row >= pageEnd) ?? sorted[0])
          : ([...sorted].reverse().find((row) => row < pageStart) ?? sorted[sorted.length - 1]);
      goToPage(Math.floor(target / pageSize));
      setActiveMatch(sorted.indexOf(target));
      const column = matchColumnsRef.current.get(target);
      if (column !== undefined) focusColumn(column, false);
    },
    [focusColumn, goToPage, matchRows, page, pageSize],
  );

  /** Abandon a running scan. The scan checks `searchSeq` between pages, so this stops it. */
  const cancelSearch = useCallback(() => {
    searchSeq.current++;
    setSearching(false);
    setProgress(null);
  }, []);

  const handleQueryChange = useCallback(
    (next: string) => {
      setQuery(next);
      if (next.trim().toLowerCase() !== searchedQuery) resetSearch();
    },
    [resetSearch, searchedQuery],
  );

  return {
    query,
    searching,
    progress,
    matchRows,
    activeMatch,
    capped,
    searchedEmpty,
    hasCurrentResults: matchRows.size > 0 && query.trim().toLowerCase() === searchedQuery,
    runSearch,
    jumpMatch,
    cancelSearch,
    resetSearch,
    handleQueryChange,
  };
}
