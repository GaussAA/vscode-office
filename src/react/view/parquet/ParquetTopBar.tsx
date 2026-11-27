import type { RefObject } from "react";
import { $t } from "../../i18n/i18nConfig.ts";
import type { ParquetFileInfo } from "@/common/parquetReader";
import { PARQUET_SEARCH_MAX_ROWS } from "@/common/parquetSearchTypes";
import { ParquetMetaBar } from "./ParquetMetaBar.tsx";
import type { ParquetSearch, ParquetSearchScope } from "./useParquetSearch";

interface ParquetTopBarProps {
  search: ParquetSearch;
  searchInputRef: RefObject<HTMLInputElement | null>;
  fileInfo: ParquetFileInfo;
  codecs: string[];
  scope: ParquetSearchScope;
  onScopeChange: (scope: ParquetSearchScope) => void;
  /** The schema-selected column, or null; only a name is needed for the option label. */
  activeColumnName?: string;
  visibleColumnCount: number;
  /** Matched columns currently hidden by "only selected", so the user can reveal them. */
  hiddenHitCount: number;
  onRevealHiddenHits: () => void;
}

/** Find controls plus the file meta; the table and its selection stay outside this bar. */
export default function ParquetTopBar({
  search,
  searchInputRef,
  fileInfo,
  codecs,
  scope,
  onScopeChange,
  activeColumnName,
  visibleColumnCount,
  hiddenHitCount,
  onRevealHiddenHits,
}: ParquetTopBarProps) {
  return (
    <header className="parquet-viewer__topbar">
      <div className="parquet-viewer__search">
        <label className="parquet-viewer__scope">
          <span className="codicon codicon-list-filter parquet-viewer__scope-icon" />
          <select
            className="parquet-viewer__scope-select"
            value={scope}
            aria-label={$t("parquet.searchScopeLabel")}
            title={$t("parquet.searchScopeLabel")}
            onChange={(event) => onScopeChange(event.target.value as ParquetSearchScope)}
          >
            <option value="all">{$t("parquet.searchScopeAll")}</option>
            <option value="active" disabled={!activeColumnName}>
              {$t("parquet.searchScopeActive")}
              {activeColumnName ? ` · ${activeColumnName}` : ""}
            </option>
            <option value="visible">
              {$t("parquet.searchScopeVisible", { count: visibleColumnCount })}
            </option>
          </select>
        </label>
        <span className="codicon codicon-search parquet-viewer__search-icon" />
        <input
          ref={searchInputRef}
          className="parquet-viewer__find-input"
          placeholder={$t("parquet.findInFile")}
          aria-label={$t("parquet.findInFile")}
          value={search.query}
          onChange={(event) => search.handleQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            // Enter follows VS Code's own find: move to the next hit. Re-running a whole-file
            // scan (1.3 s on a million rows) belongs on the button and on Ctrl/Cmd+Enter.
            if (event.ctrlKey || event.metaKey) void search.runSearch();
            else if (search.hasCurrentResults) search.jumpMatch(event.shiftKey ? -1 : 1);
            else void search.runSearch();
          }}
        />
        {search.query && (
          <button
            type="button"
            className="parquet-viewer__find-clear"
            onClick={() => {
              search.handleQueryChange("");
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
          onClick={() => (search.searching ? search.cancelSearch() : void search.runSearch())}
          title={search.searching ? $t("parquet.stopSearch") : $t("parquet.searchAllRows")}
          aria-label={search.searching ? $t("parquet.stopSearch") : $t("parquet.searchAllRows")}
        >
          <span className={`codicon ${search.searching ? "codicon-stop-circle" : "codicon-run"}`} />
        </button>
      </div>
      <div className="parquet-viewer__find-state">
        {search.searching && search.progress && (
          <span className="parquet-viewer__find-count">
            {Math.round((search.progress.scanned / Math.max(1, search.progress.total)) * 100)}%
            {" · "}
            {search.progress.matches}
          </span>
        )}
        {!search.searching &&
          search.query.trim() !== "" &&
          search.matchRows.size === 0 &&
          !search.searchedEmpty && (
            <span className="parquet-viewer__find-count">{$t("parquet.searchHint")}</span>
          )}
        {!search.searching && search.matchRows.size > 0 && (
          <>
            <span className="parquet-viewer__find-count">
              {$t("parquet.matchPosition", {
                index: (search.activeMatch ?? 0) + 1,
                count: search.matchRows.size.toLocaleString(),
              })}
              {search.capped
                ? $t("parquet.cappedSuffix", {
                    max: PARQUET_SEARCH_MAX_ROWS.toLocaleString(),
                  })
                : ""}
            </span>
            <button
              type="button"
              className="parquet-viewer__find-btn"
              onClick={() => search.jumpMatch(-1)}
              title={$t("parquet.previousMatch")}
              aria-label={$t("parquet.previousMatch")}
            >
              <span className="codicon codicon-chevron-up" />
            </button>
            <button
              type="button"
              className="parquet-viewer__find-btn"
              onClick={() => search.jumpMatch(1)}
              title={$t("parquet.nextMatch")}
              aria-label={$t("parquet.nextMatch")}
            >
              <span className="codicon codicon-chevron-down" />
            </button>
          </>
        )}
        {!search.searching && hiddenHitCount > 0 && (
          <button
            type="button"
            className="parquet-viewer__hidden-hit"
            onClick={onRevealHiddenHits}
            title={$t("parquet.showHiddenHit")}
          >
            <span className="codicon codicon-eye-closed" aria-hidden="true" />
            {$t("parquet.hiddenHit", { count: hiddenHitCount })}
          </button>
        )}
        {!search.searching && search.searchedEmpty && (
          <span className="parquet-viewer__find-count">
            {$t("parquet.matchCountMany", { count: "0" })}
          </span>
        )}
      </div>
      <ParquetMetaBar
        rowCount={fileInfo.rowCount}
        columnCount={fileInfo.columns.length}
        fileSize={fileInfo.file?.byteLength}
        codecs={codecs}
        createdBy={fileInfo.createdBy}
      />
    </header>
  );
}
