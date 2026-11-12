import { useCallback, useEffect, useRef, useState } from "react";
import { searchSheetRows, stepMatch } from "./sheetSearch";
import type { SheetSource } from "./sheetSource";
import { t } from "./excel_i18n";
import { ROW_HEIGHT } from "./windowedSheetModel";

export interface WindowedFind {
  query: string;
  searchedQuery: string;
  matches: number[];
  capped: boolean;
  searching: boolean;
  progress: { scanned: number; matches: number } | null;
  isSearchResult: boolean;
  countLabel: string;
  runSearch: () => Promise<void>;
  step: (direction: 1 | -1) => void;
  handleQueryChange: (value: string) => void;
}

interface UseWindowedFindArgs {
  source: SheetSource;
  rowCount: number;
  bodyScrollTop: number;
  jumpToRow: (row: number) => void;
  onError: (message: string) => void;
}

/**
 * Find state for a windowed sheet. The source is already header-free; a hit is a body row,
 * so the caller only has to translate it into file coordinates for display.
 */
export function useWindowedFind({
  source,
  rowCount,
  bodyScrollTop,
  jumpToRow,
  onError,
}: UseWindowedFindArgs): WindowedFind {
  const searchSeq = useRef(0);
  /** Body row the find bar last jumped to; stepping is relative to this, not the viewport. */
  const activeMatch = useRef<number | null>(null);
  const [query, setQuery] = useState("");
  const [searchedQuery, setSearchedQuery] = useState("");
  const [matches, setMatches] = useState<number[]>([]);
  const [capped, setCapped] = useState(false);
  const [searching, setSearching] = useState(false);
  const [progress, setProgress] = useState<{ scanned: number; matches: number } | null>(null);

  const needle = query.trim();
  const isSearchResult = needle !== "" && searchedQuery === needle;

  const runSearch = useCallback(async () => {
    const ticket = ++searchSeq.current;
    setQuery(needle);
    setCapped(false);
    if (!needle) {
      activeMatch.current = null;
      setSearchedQuery("");
      setMatches([]);
      setProgress(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    setProgress({ scanned: 0, matches: 0 });
    try {
      const result = await searchSheetRows(source, needle, {
        isCancelled: () => ticket !== searchSeq.current,
        onProgress: (scanned, found) => {
          if (ticket === searchSeq.current) setProgress({ scanned, matches: found });
        },
      });
      if (ticket !== searchSeq.current || result.cancelled) return;
      setMatches(result.rows);
      setCapped(result.capped);
      setSearchedQuery(needle);
      if (result.rows.length > 0) {
        activeMatch.current = result.rows[0];
        jumpToRow(result.rows[0]);
      }
    } catch (cause) {
      if (ticket === searchSeq.current) {
        onError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      if (ticket === searchSeq.current) {
        setSearching(false);
        setProgress(null);
      }
    }
  }, [jumpToRow, needle, onError, source]);

  const step = useCallback(
    (direction: 1 | -1) => {
      const fallback = Math.floor(Math.max(0, bodyScrollTop) / ROW_HEIGHT);
      const target = stepMatch(matches, activeMatch.current, direction, fallback);
      if (target !== undefined) {
        activeMatch.current = target;
        jumpToRow(target);
      }
    },
    [bodyScrollTop, jumpToRow, matches],
  );

  /** Invalidate a scan that outlives the component; its result must not touch a new sheet. */
  const cancelSearch = useCallback(() => {
    searchSeq.current++;
  }, []);
  useEffect(() => cancelSearch, [cancelSearch]);

  const handleQueryChange = useCallback((value: string) => {
    setQuery(value);
    // A new query invalidates the old hit list; stale highlights are worse than an empty state.
    searchSeq.current++;
    activeMatch.current = null;
    setSearchedQuery("");
    setMatches([]);
    setCapped(false);
    setProgress(null);
    setSearching(false);
  }, []);

  const countLabel = searching
    ? `${Math.round(((progress?.scanned ?? 0) / Math.max(1, rowCount)) * 100)}% · ${progress?.matches ?? 0}`
    : !isSearchResult
      ? ""
      : matches.length === 0
        ? t("findReplace.notFound")
        : matches.length === 1 && !capped
          ? t("viewer.matchesOne", "1")
          : t("viewer.matchesMany", `${matches.length.toLocaleString()}${capped ? "+" : ""}`);

  return {
    query,
    searchedQuery,
    matches,
    capped,
    searching,
    progress,
    isSearchResult,
    countLabel,
    runSearch,
    step,
    handleQueryChange,
  };
}
