import { ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import { Button, ConfigProvider, Input, InputNumber, Splitter, theme as antdTheme } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  JSONL_CHUNK_SIZE,
  type JsonlEntriesPayload,
  type JsonlEntryDetail,
  type JsonlEntryPayload,
  type JsonlEntrySummary,
  type JsonlInfoPayload,
  type JsonlSearchBatch,
} from "../../../common/jsonlTypes.ts";
import { jsonViewerThemeTokens } from "../../common/jsonViewerTheme.ts";
import { handler } from "../../util/vscode.ts";
import { $t } from "../../i18n/i18nConfig.ts";
import { useVscodeDarkTheme } from "../../util/vscodeTheme.ts";
import JsonlDetail, { type DetailMode } from "./JsonlDetail.tsx";
import JsonlIndex from "./JsonlIndex.tsx";
import { DEFAULT_LEFT_WIDTH, LEFT_MAX, LEFT_MIN } from "./jsonlLayout";
import { loadJsonlPersisted, saveJsonlPersisted } from "./jsonlPersistence";
import { formatBytes } from "./jsonlFormat.ts";
import "./Jsonl.less";

const SEARCH_DEBOUNCE_MS = 250;

interface SearchMeta {
  matches: number;
  scanned: number;
  total: number;
  done: boolean;
  capped: boolean;
}

export default function JsonlViewer() {
  const [info, setInfo] = useState<JsonlInfoPayload | null>(null);
  /**
   * The directory window: one contiguous range and its rows, in a single value. The old
   * pair of a `Map` plus a `{start,end}` could disagree — a late reply extended the range
   * without filling the middle, and nothing ever asked for the hole.
   */
  const [directory, setDirectory] = useState<{
    start: number;
    end: number;
    items: JsonlEntrySummary[];
  }>({
    start: 0,
    end: 0,
    items: [],
  });
  const [selected, setSelected] = useState(0);
  const [detail, setDetail] = useState<JsonlEntryDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [chunkLoading, setChunkLoading] = useState(false);
  const [leftWidth, setLeftWidth] = useState(DEFAULT_LEFT_WIDTH);
  const [detailBar, setDetailBar] = useState<HTMLDivElement | null>(null);
  const [mode, setMode] = useState<DetailMode>("tree");
  const [jumpValue, setJumpValue] = useState<number | null>(null);
  const dark = useVscodeDarkTheme();

  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchEntries, setSearchEntries] = useState<JsonlEntrySummary[]>([]);
  const [searchMeta, setSearchMeta] = useState<SearchMeta | null>(null);

  const infoRef = useRef<JsonlInfoPayload | null>(null);
  const selectedRef = useRef(0);
  const queryRef = useRef("");
  const rangeSeq = useRef(0);
  /** requestId -> what that request is allowed to do to the window when its reply lands. */
  const rangeMode = useRef(new Map<number, "replace" | "append">());
  const entrySeq = useRef(0);
  const searchSeq = useRef(0);
  const searchTimer = useRef<number | undefined>(undefined);
  const searchAutoSelected = useRef(false);
  const pendingJump = useRef<number | null>(null);

  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);
  useEffect(() => {
    queryRef.current = query;
  }, [query]);

  const requestRange = useCallback(
    (start: number, end: number, mode: "replace" | "append", anchor?: number) => {
      const requestId = ++rangeSeq.current;
      rangeMode.current.set(requestId, mode);
      setChunkLoading(true);
      handler.emit("jsonlIndex", {
        requestId,
        start,
        end,
        ...(typeof anchor === "number" ? { anchor } : {}),
      });
    },
    [],
  );

  const requestEntry = useCallback((index: number) => {
    const requestId = ++entrySeq.current;
    setDetail(null);
    setDetailLoading(true);
    handler.emit("jsonlEntry", { requestId, index });
  }, []);

  const selectEntry = useCallback(
    (index: number) => {
      setSelected(index);
      requestEntry(index);
    },
    [requestEntry],
  );

  /** Load a window of entries around `target`, keeping `target` in it. */
  const recenter = useCallback(
    (target: number, lineCount: number) => {
      const begin = Math.max(0, Math.min(target - 100, Math.max(0, lineCount - JSONL_CHUNK_SIZE)));
      requestRange(begin, Math.min(lineCount, begin + JSONL_CHUNK_SIZE), "replace", target);
    },
    [requestRange],
  );

  const startSearch = useCallback((text: string) => {
    const trimmed = text.trim();
    const previous = searchSeq.current;
    const requestId = ++searchSeq.current;
    // Tell the host to stop the old scan; ignoring its output would leave it running.
    if (previous) handler.emit("jsonlSearchCancel", { requestId: previous });
    searchAutoSelected.current = false;
    setSearchEntries([]);
    setSearchMeta(null);
    if (!trimmed) return;
    setSearching(true);
    handler.emit("jsonlSearch", { requestId, query: trimmed });
  }, []);

  useEffect(() => {
    handler.on("jsonlInfo", (payload: JsonlInfoPayload) => {
      const previous = infoRef.current;
      const isSameFile = previous?.cacheId === payload.cacheId;
      infoRef.current = payload;
      setInfo(payload);

      let target = selectedRef.current;
      if (!isSameFile) {
        const restored = loadJsonlPersisted(payload.cacheId);
        if (restored) {
          setLeftWidth(restored.left);
          setMode(restored.mode);
        }
        target = restored?.selected ?? 0;
        setQuery("");
        queryRef.current = "";
        setSearching(false);
        setSearchEntries([]);
        setSearchMeta(null);
        searchSeq.current++;
      }
      target = Math.max(0, Math.min(payload.lineCount - 1, target));

      setDirectory({ start: 0, end: 0, items: [] });
      setSelected(target);
      if (payload.lineCount === 0) {
        setDetail(null);
        setDetailLoading(false);
      } else {
        recenter(target, payload.lineCount);
        requestEntry(target);
      }

      // A same-file refresh re-runs the active search against the new bytes. A different
      // document starts clean: reusing the old ref here would start a scan while the search
      // box is visibly empty.
      const activeQuery = isSameFile ? queryRef.current.trim() : "";
      if (activeQuery) startSearch(activeQuery);
    });

    handler.on("jsonlEntries", (payload: JsonlEntriesPayload) => {
      const mode = rangeMode.current.get(payload.requestId);
      if (!mode) return; // a reply nobody is waiting for any more
      rangeMode.current.delete(payload.requestId);
      if (payload.requestId === rangeSeq.current) setChunkLoading(false);
      // A replace that a newer replace has already superseded must not repaint the pane: the
      // newer request owns the anchor guarantee for the row the user jumped to.
      if (mode === "replace" && payload.requestId !== rangeSeq.current) return;
      if (!payload.entries.length) return;

      const end = payload.start + payload.entries.length;
      setDirectory((prev) => {
        if (mode === "replace") return { start: payload.start, end, items: payload.entries };
        // An append is only valid when it continues the window; anything else is
        // stale, and moving `end` would claim rows we never received.
        if (payload.start !== prev.end) return prev;
        return { start: prev.start, end, items: [...prev.items, ...payload.entries] };
      });
    });

    handler.on("jsonlEntryData", (payload: JsonlEntryPayload) => {
      if (payload.requestId !== entrySeq.current) return;
      if (payload.index !== selectedRef.current) return;
      setDetail(payload.entry);
      setDetailLoading(false);
    });

    handler.on("jsonlSearchBatch", (batch: JsonlSearchBatch) => {
      if (batch.requestId !== searchSeq.current) return;
      if (batch.entries.length) {
        setSearchEntries((prev) => [...prev, ...batch.entries]);
        if (!searchAutoSelected.current) {
          searchAutoSelected.current = true;
          const first = batch.entries[0];
          if (first) selectEntry(first.index);
        }
      }
      setSearchMeta({
        matches: batch.matches,
        scanned: batch.scanned,
        total: batch.total,
        done: batch.done,
        capped: batch.capped,
      });
      if (batch.done) setSearching(false);
    });

    handler.emit("init");
  }, [recenter, requestEntry, selectEntry, startSearch]);

  const clearSearch = useCallback(() => {
    // Stop the host-side scan instead of letting it run to completion unread.
    const previous = searchSeq.current;
    if (searching) handler.emit("jsonlSearchCancel", { requestId: previous });
    // Reject batches already in flight. Without the bump a late batch can append results and
    // auto-select an entry after the user has left search mode.
    searchSeq.current++;
    searchAutoSelected.current = false;
    setSearching(false);
    setSearchEntries([]);
    setSearchMeta(null);
    if (info) {
      const target = pendingJump.current ?? selectedRef.current;
      pendingJump.current = null;
      recenter(Math.max(0, Math.min(info.lineCount - 1, target)), info.lineCount);
    }
  }, [info, recenter, searching]);

  const handleQueryChange = useCallback(
    (next: string) => {
      window.clearTimeout(searchTimer.current);
      setQuery(next);
      if (!next.trim()) clearSearch();
    },
    [clearSearch],
  );

  // search: debounce typing (the reset itself happens in the change handler, not here)
  useEffect(() => {
    window.clearTimeout(searchTimer.current);
    const trimmed = query.trim();
    if (!trimmed) return;
    searchTimer.current = window.setTimeout(() => startSearch(trimmed), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(searchTimer.current);
  }, [query, startSearch]);

  useEffect(() => {
    if (!info) return;
    saveJsonlPersisted(info.cacheId, { left: leftWidth, selected, mode });
  }, [info, leftWidth, selected, mode]);

  const onNeedMore = useCallback(() => {
    if (!info || directory.end >= info.lineCount || chunkLoading) return;
    requestRange(
      directory.end,
      Math.min(info.lineCount, directory.end + JSONL_CHUNK_SIZE),
      "append",
    );
  }, [info, directory.end, chunkLoading, requestRange]);

  const searchActive = query.trim().length > 0;
  const items = searchActive ? searchEntries : directory.items;
  const hasMore = !searchActive && info !== null && directory.end < info.lineCount;

  const jump = useCallback(() => {
    if (!info || info.lineCount === 0 || jumpValue == null) return;
    const target = Math.min(info.lineCount - 1, Math.max(0, Math.round(jumpValue) - 1));
    if (query.trim()) {
      // Leaving search mode has to go through `clearSearch`: it stops the host scan, clears
      // the results and recenters the directory on `pendingJump`. Setting `query` to "" here
      // used to skip all three, so the directory kept a window that did not contain the row
      // the user had just jumped to, and the host kept scanning.
      pendingJump.current = target;
      setQuery("");
      clearSearch();
      selectEntry(target);
      return;
    }
    if (target < directory.start || target >= directory.end) recenter(target, info.lineCount);
    selectEntry(target);
  }, [info, jumpValue, directory, query, clearSearch, recenter, selectEntry]);

  const searchStatus = useMemo(() => {
    if (!searchActive) return null;
    if (searching || (searchMeta && !searchMeta.done)) {
      const percent =
        searchMeta && searchMeta.total > 0
          ? Math.round((searchMeta.scanned / searchMeta.total) * 100)
          : 0;
      return (
        <span className="jsonl-search-status" aria-live="polite">
          {$t("jsonl.searching", { percent, count: searchMeta?.matches ?? 0 })}
        </span>
      );
    }
    if (!searchMeta) return null;
    const label =
      searchMeta.matches === 1
        ? $t("jsonl.matchCountOne", { count: searchMeta.matches })
        : $t("jsonl.matchCountMany", { count: searchMeta.matches });
    return (
      <span className="jsonl-search-status" aria-live="polite">
        {searchMeta.matches === 0
          ? $t("jsonl.noMatches")
          : `${label}${searchMeta.capped ? $t("jsonl.cappedSuffix") : ""}`}
      </span>
    );
  }, [searchActive, searching, searchMeta]);

  const themeTokens = useMemo(() => jsonViewerThemeTokens(dark), [dark]);

  const total = info?.lineCount ?? 0;

  return (
    <ConfigProvider
      theme={{
        algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        token: themeTokens,
      }}
    >
      <div className={`jsonl-viewer${dark ? "" : " jsonl-viewer--light"}`}>
        <div className="jsonl-toolbar">
          <div className="jsonl-toolbar__left">
            <span className="jsonl-file-name" title={info?.fileName}>
              {info?.fileName ?? "JSONL"}
            </span>
            <span className="jsonl-meta">
              {$t("jsonl.entriesCount", { count: total.toLocaleString() })}
            </span>
            <span className="jsonl-dot">·</span>
            <span className="jsonl-meta">{formatBytes(info?.byteSize ?? 0)}</span>
          </div>
          <div className="jsonl-toolbar__right">
            <Input
              size="small"
              allowClear
              prefix={<SearchOutlined />}
              placeholder={$t("jsonl.searchPlaceholder")}
              className="jsonl-search"
              value={query}
              onChange={(event) => handleQueryChange(event.target.value)}
            />
            {searchStatus}
            <InputNumber
              size="small"
              min={1}
              max={Math.max(1, total)}
              value={jumpValue}
              placeholder={$t("jsonl.jumpPlaceholder")}
              className="jsonl-jump"
              disabled={total === 0}
              onChange={(value) => setJumpValue(typeof value === "number" ? value : null)}
              onPressEnter={jump}
            />
            <Button size="small" disabled={total === 0} onClick={jump}>
              {$t("jsonl.go")}
            </Button>
            <Button
              type="text"
              size="small"
              icon={<ReloadOutlined />}
              title={$t("jsonl.reload")}
              onClick={() => handler.emit("jsonlReload")}
            />
          </div>
        </div>

        {info && total === 0 ? (
          <div className="jsonl-empty jsonl-empty--viewer">
            <span className="codicon codicon-file" />
            <span>{$t("jsonl.empty")}</span>
          </div>
        ) : (
          <>
            <Splitter
              key={info?.cacheId ?? "pending"}
              className="jsonl-splitter"
              onResize={(sizes) => setLeftWidth(sizes[0] ?? DEFAULT_LEFT_WIDTH)}
            >
              <Splitter.Panel
                defaultSize={leftWidth}
                min={LEFT_MIN}
                max={LEFT_MAX}
                className="jsonl-splitter__panel"
              >
                <JsonlIndex
                  items={items}
                  selected={selected}
                  loading={searchActive ? false : chunkLoading}
                  onSelect={selectEntry}
                  onNeedMore={searchActive ? undefined : onNeedMore}
                  hasMore={hasMore}
                  windowStart={directory.start}
                  highlight={searchActive ? query.trim() : undefined}
                  emptyText={
                    !info
                      ? $t("jsonl.loading")
                      : searchActive
                        ? searching
                          ? $t("jsonl.searchingShort")
                          : $t("jsonl.noMatches")
                        : chunkLoading
                          ? $t("jsonl.loading")
                          : $t("jsonl.empty")
                  }
                />
              </Splitter.Panel>
              <Splitter.Panel className="jsonl-splitter__panel">
                <JsonlDetail
                  // Include the document: reopening a file on the same entry number must not
                  // inherit the previous tree's explicit expansion or selected key.
                  key={`${info?.cacheId ?? "pending"}:${selected}`}
                  index={selected}
                  entry={detail}
                  loading={detailLoading || !info}
                  mode={mode}
                  onModeChange={setMode}
                  actionsHost={detailBar}
                />
              </Splitter.Panel>
            </Splitter>
            <footer className="jsonl-bottombar">
              <div className="jsonl-bottombar__detail" ref={setDetailBar} />
            </footer>
          </>
        )}
      </div>
    </ConfigProvider>
  );
}
