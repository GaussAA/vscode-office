import { useCallback, useEffect, useRef, useState } from "react";
import { RequestGuard } from "../../util/requestGuard";
import { searchSheetRows, stepMatch } from "./sheetSearch";
import { getWindowedFindMemo, setWindowedFindMemo } from "./windowedFindMemo";
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
  const searchGuard = useRef(new RequestGuard());
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
    const ticket = searchGuard.current.issue();
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
    const cached = getWindowedFindMemo(needle);
    if (cached) {
      setMatches(cached.rows);
      setCapped(cached.capped);
      setSearchedQuery(needle);
      setSearching(false);
      setProgress(null);
      if (cached.rows.length > 0) {
        activeMatch.current = cached.rows[0];
        jumpToRow(cached.rows[0]);
      }
      return;
    }
    setSearching(true);
    setProgress({ scanned: 0, matches: 0 });
    try {
      const result = await searchSheetRows(source, needle, {
        isCancelled: () => !searchGuard.current.isCurrent(ticket),
        onProgress: (scanned, found) => {
          if (searchGuard.current.isCurrent(ticket)) setProgress({ scanned, matches: found });
        },
      });
      if (!searchGuard.current.isCurrent(ticket) || result.cancelled) return;
      setMatches(result.rows);
      setCapped(result.capped);
      setSearchedQuery(needle);
      if (!result.cancelled)
        setWindowedFindMemo(needle, { rows: result.rows, capped: result.capped });
      if (result.rows.length > 0) {
        activeMatch.current = result.rows[0];
        jumpToRow(result.rows[0]);
      }
    } catch (cause) {
      if (searchGuard.current.isCurrent(ticket)) {
        onError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      if (searchGuard.current.isCurrent(ticket)) {
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
    searchGuard.current.cancel();
  }, []);
  useEffect(() => cancelSearch, [cancelSearch]);

  const handleQueryChange = useCallback((value: string) => {
    setQuery(value);
    // A new query invalidates the old hit list; stale highlights are worse than an empty state.
    searchGuard.current.cancel();
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
