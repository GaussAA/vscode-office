import { ConfigProvider, Splitter, theme as antdTheme } from "antd";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { JsonlEntryDetail } from "../../../common/jsonlTypes.ts";
import {
  JSON_RECORD_WINDOW,
  type JsonInfoPayload,
  type JsonRecordSummary,
  type JsonRecordsPayload,
  type JsonRootPayload,
  type JsonSearchBatch,
  type JsonSearchRecord,
} from "../../../common/jsonPreviewTypes.ts";
import {
  clearPersistedPrefix,
  loadVersionedState,
  saveVersionedState,
} from "../../common/versionedState.ts";
import { jsonViewerThemeTokens } from "../../common/jsonViewerTheme.ts";
import { PendingRequests, RequestGuard } from "../../util/requestGuard.ts";
import { handler } from "../../util/vscode.ts";
import { useVscodeDarkTheme } from "../../util/vscodeTheme.ts";
import { $t } from "../../i18n/i18nConfig.ts";
import EntryDetail, { type DetailMode } from "../entry/EntryDetail.tsx";
import JsonRecordList from "./JsonRecordList.tsx";
import JsonPreviewToolbar from "./JsonPreviewToolbar.tsx";
import JsonPreviewState from "./JsonPreviewState.tsx";
import JsonSearchRail, { type JsonSearchRow } from "./JsonSearchRail.tsx";
import { collectMatchPaths, firstMatchKey } from "./jsonPreviewFormat.ts";
import "./JsonPreview.less";

const DEFAULT_LEFT_WIDTH = 340;
const LEFT_PREFIX = "json-preview:left:";
const LEFT_VERSION = 1;
const LEFT_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
const SEARCH_DEBOUNCE_MS = 250;

interface SearchMeta {
  capped: boolean;
}

function clampLeft(value: number): number {
  return value >= 220 && value <= 560 ? value : DEFAULT_LEFT_WIDTH;
}

function parseLeft(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  const left = (value as { left?: unknown }).left;
  return typeof left === "number" ? clampLeft(left) : null;
}

function loadLeft(cacheId: string): number {
  try {
    const raw = localStorage.getItem(LEFT_PREFIX + cacheId);
    // Legacy entries were a bare number, which the versioned wrapper cannot parse.
    if (raw && !raw.trim().startsWith("{")) {
      const value = Number(raw);
      if (Number.isFinite(value)) {
        const clamped = clampLeft(value);
        saveLeft(cacheId, clamped);
        return clamped;
      }
    }
  } catch {}
  return (
    loadVersionedState(LEFT_PREFIX, cacheId, {
      version: LEFT_VERSION,
      maxAgeMs: LEFT_MAX_AGE_MS,
      parse: parseLeft,
      parseLegacy: parseLeft,
    }) ?? DEFAULT_LEFT_WIDTH
  );
}

function saveLeft(cacheId: string, value: number): void {
  saveVersionedState(LEFT_PREFIX, cacheId, LEFT_VERSION, { left: clampLeft(value) });
}

function clearJsonPreviewLeft(): void {
  clearPersistedPrefix(LEFT_PREFIX);
}

/** A command-opened, read-only JSON inspection surface. It is not a custom editor. */
export default function JsonPreview() {
  const [info, setInfo] = useState<JsonInfoPayload | null>(null);
  const [root, setRoot] = useState<JsonlEntryDetail | null>(null);
  const [selected, setSelected] = useState(0);
  const [detail, setDetail] = useState<JsonlEntryDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [labels] = useState<Map<number, JsonRecordSummary>>(() => new Map());
  const [, setLabelsVersion] = useState(0);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<JsonSearchRecord[]>([]);
  const [searchMeta, setSearchMeta] = useState<SearchMeta | null>(null);
  /** Bumped when a refresh must re-run the same query against the new bytes. */
  const [searchEpoch, setSearchEpoch] = useState(0);
  const [reveal, setReveal] = useState<{ key: string; nonce: number } | null>(null);
  const revealSeq = useRef(0);
  const revealAt = useCallback((key: string) => {
    revealSeq.current++;
    setReveal({ key, nonce: revealSeq.current });
  }, []);
  const [mode, setMode] = useState<DetailMode>("tree");
  const [actionsHost, setActionsHost] = useState<HTMLDivElement | null>(null);
  const dark = useVscodeDarkTheme();

  const infoRef = useRef<JsonInfoPayload | null>(null);
  const selectedRef = useRef(0);
  const queryRef = useRef("");
  const entries = useRef(new RequestGuard());
  /** Record windows in flight. A new document clears them, so an old document's reply is dropped. */
  const records = useRef(new PendingRequests());
  /** The search scan; `cancel()` says whether the host is still running one. */
  const search = useRef(new RequestGuard());
  const requestedWindows = useRef(new Set<number>());

  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);
  useEffect(() => {
    queryRef.current = query.trim();
  }, [query]);

  const requestWindows = useCallback((start: number, end: number) => {
    const current = infoRef.current;
    if (!current || current.rootKind !== "array") return;
    const first = Math.max(0, Math.floor(start / JSON_RECORD_WINDOW) * JSON_RECORD_WINDOW);
    const last = Math.max(
      first,
      Math.floor(Math.max(start, end - 1) / JSON_RECORD_WINDOW) * JSON_RECORD_WINDOW,
    );
    for (let windowStart = first; windowStart <= last; windowStart += JSON_RECORD_WINDOW) {
      if (requestedWindows.current.has(windowStart)) continue;
      requestedWindows.current.add(windowStart);
      const requestId = records.current.issue();
      handler.emit("jsonRecords", {
        requestId,
        start: windowStart,
        end: windowStart + JSON_RECORD_WINDOW,
      });
    }
  }, []);

  const requestDetail = useCallback((index: number) => {
    const current = infoRef.current;
    if (!current || current.rootKind !== "array" || current.recordCount === 0) return;
    const requestId = entries.current.issue();
    setDetailLoading(true);
    handler.emit("jsonRecord", { requestId, index });
  }, []);

  useEffect(() => {
    const onInfo = (payload: JsonInfoPayload) => {
      const previous = infoRef.current;
      const sameFile = previous?.cacheId === payload.cacheId;
      const sameShape = sameFile && previous?.rootKind === payload.rootKind;
      infoRef.current = payload;
      requestedWindows.current = new Set();
      records.current.clear();
      const staleSearch = search.current.cancel();
      if (staleSearch !== null) handler.emit("jsonSearchCancel", { requestId: staleSearch });
      setInfo(payload);
      labels.clear();
      setLabelsVersion((version) => version + 1);
      setDetail(null);
      setRoot(null);
      setDetailLoading(payload.rootKind === "array");
      setReveal(null);
      if (sameShape) {
        const next =
          payload.rootKind === "array"
            ? Math.min(Math.max(0, selectedRef.current), Math.max(0, payload.recordCount - 1))
            : 0;
        setSelected(next);
        selectedRef.current = next;
        // A reload of the same document keeps the query; the effect below re-runs it against
        // the new bytes. Results themselves belong to the old bytes and are dropped.
        setResults([]);
        setSearchMeta(null);
        setSearching(payload.rootKind === "array" && queryRef.current.trim() !== "");
        setSearchEpoch((epoch) => epoch + 1);
      } else {
        setSelected(0);
        selectedRef.current = 0;
        setQuery("");
        queryRef.current = "";
        setResults([]);
        setSearching(false);
        setSearchMeta(null);
      }
      if (payload.rootKind === "array") requestWindows(0, JSON_RECORD_WINDOW);
    };

    handler
      .on("jsonInfo", onInfo)
      .on("jsonRoot", (payload: JsonRootPayload) => {
        setRoot(payload.entry);
        setDetail(payload.entry);
        setDetailLoading(false);
      })
      .on("jsonRecordsData", (payload: JsonRecordsPayload) => {
        if (!records.current.take(payload.requestId)) return;
        if (!payload.records.length) return;
        for (const record of payload.records) labels.set(record.index, record);
        setLabelsVersion((version) => version + 1);
      })
      .on(
        "jsonRecordData",
        (payload: { requestId: number; index: number; entry: JsonlEntryDetail | null }) => {
          if (!entries.current.isCurrent(payload.requestId)) return;
          if (payload.index !== selectedRef.current) return;
          setDetail(payload.entry);
          setDetailLoading(false);
          const term = queryRef.current;
          const key =
            term && payload.entry?.kind === "value"
              ? firstMatchKey(payload.entry.value, term)
              : null;
          if (key) revealAt(key);
          else setReveal(null);
        },
      )
      .on("jsonSearchBatch", (batch: JsonSearchBatch) => {
        if (!search.current.isCurrent(batch.requestId)) return;
        if (batch.records.length) {
          setResults((previous) => [...previous, ...batch.records]);
        }
        setSearchMeta({ capped: batch.capped });
        if (batch.done) {
          search.current.settle(batch.requestId);
          setSearching(false);
        }
      });

    handler.on("clearJsonPreviewCache", () => {
      clearJsonPreviewLeft();
      handler.emit("jsonReload");
    });

    handler.emit("init");
  }, [labels, requestWindows, revealAt]);

  useEffect(() => {
    if (info?.rootKind !== "array") return;
    requestDetail(selected);
  }, [info, requestDetail, selected]);

  useEffect(() => {
    const term = query.trim();
    if (!term || infoRef.current?.rootKind !== "array") return;
    setSearching(true);
    const timer = window.setTimeout(() => {
      const requestId = search.current.issue();
      handler.emit("jsonSearch", { requestId, query: term });
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query, searchEpoch]);

  const searchActive = query.trim().length > 0;
  const deferredQuery = useDeferredValue(query);
  const arrayRoot = info?.rootKind === "array";
  const recordCount = info?.recordCount ?? 0;
  const pathResults = useMemo(() => {
    if (!searchActive || arrayRoot || !root || root.kind !== "value") return [];
    return collectMatchPaths(root.value, deferredQuery.trim());
  }, [arrayRoot, deferredQuery, root, searchActive]);

  const handleQueryChange = useCallback((value: string) => {
    const term = value.trim();
    setQuery(value);
    queryRef.current = term;
    const stale = search.current.cancel();
    if (stale !== null) handler.emit("jsonSearchCancel", { requestId: stale });
    setResults([]);
    setSearchMeta(null);
    setReveal(null);
    setSearching(term.length > 0 && infoRef.current?.rootKind === "array");
  }, []);

  const searchRows: JsonSearchRow[] = arrayRoot
    ? results.map((record) => ({
        key: `record-${record.index}`,
        index: record.index,
        snippet: record.snippet,
        count: record.count,
      }))
    : pathResults.map((match) => ({
        key: match.key,
        path: match.path,
        snippet: match.snippet,
      }));
  const selectedSearchKey = arrayRoot
    ? searchRows.some((row) => row.index === selected)
      ? `record-${selected}`
      : undefined
    : reveal?.key;

  const onSelectRecord = useCallback((index: number) => {
    setSelected(index);
    setReveal(null);
  }, []);

  const onSelectSearchRow = useCallback(
    (row: JsonSearchRow) => {
      if (row.index !== undefined) {
        const same = row.index === selectedRef.current;
        const term = queryRef.current;
        setSelected(row.index);
        if (same && term && detail?.kind === "value") {
          const key = firstMatchKey(detail.value, term);
          if (key) revealAt(key);
        } else {
          setReveal(null);
        }
      } else {
        revealAt(row.key);
      }
    },
    [detail, revealAt],
  );

  const openText = () => handler.emit("jsonOpenText");
  const reload = () => handler.emit("jsonReload");

  const themeTokens = useMemo(() => jsonViewerThemeTokens(dark), [dark]);

  const meta = info
    ? arrayRoot
      ? $t("json.recordsCount", { count: recordCount.toLocaleString() })
      : info.rootKind === "scalar"
        ? $t("json.scalarRoot")
        : $t("json.objectRoot")
    : null;

  const searchStatus = searchActive ? (
    <span className="jsonl-search-status" aria-live="polite">
      {arrayRoot && searching
        ? $t("jsonl.searchingShort")
        : $t(searchRows.length === 1 ? "jsonl.matchCountOne" : "jsonl.matchCountMany", {
            count: searchRows.length,
          })}
      {searchMeta?.capped && !searching ? $t("jsonl.cappedSuffix") : ""}
    </span>
  ) : null;

  const wrap = (body: React.ReactNode) => (
    <ConfigProvider
      theme={{
        algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        token: themeTokens,
      }}
    >
      <div className={`jsonl-viewer json-preview${dark ? "" : " jsonl-viewer--light"}`}>
        <JsonPreviewToolbar
          info={info}
          meta={meta}
          query={query}
          searchStatus={searchStatus}
          onQueryChange={handleQueryChange}
          onReload={reload}
          onOpenText={openText}
        />
        {body}
      </div>
    </ConfigProvider>
  );

  if (!info) {
    return wrap(<JsonPreviewState kind="loading" onOpenText={openText} />);
  }

  if (info.rootKind === "invalid") {
    return wrap(<JsonPreviewState kind="invalid" info={info} onOpenText={openText} />);
  }

  if (info.rootKind === "too-large") {
    return wrap(<JsonPreviewState kind="too-large" onOpenText={openText} />);
  }

  if (arrayRoot && recordCount === 0) {
    return wrap(<JsonPreviewState kind="empty" onOpenText={openText} />);
  }

  const detailElement = (
    <EntryDetail
      key={arrayRoot ? `record-${selected}` : `root-${info.cacheId}`}
      index={arrayRoot ? selected : 0}
      entry={arrayRoot ? detail : root}
      loading={arrayRoot ? detailLoading : !root}
      mode={mode}
      onModeChange={setMode}
      actionsHost={actionsHost}
      entryLabel={arrayRoot ? `[${selected}]` : "root"}
      highlight={searchActive ? query.trim() : undefined}
      revealKey={reveal?.key}
      revealNonce={reveal?.nonce}
    />
  );

  const rail = arrayRoot ? (
    searchActive ? (
      <JsonSearchRail
        rows={searchRows}
        selectedKey={selectedSearchKey}
        query={query.trim()}
        loading={searching}
        onSelect={onSelectSearchRow}
      />
    ) : (
      <JsonRecordList
        count={recordCount}
        labels={labels}
        selected={selected}
        onSelect={onSelectRecord}
        onNeedRange={requestWindows}
      />
    )
  ) : searchActive ? (
    <JsonSearchRail
      rows={searchRows}
      selectedKey={selectedSearchKey}
      query={query.trim()}
      loading={false}
      onSelect={onSelectSearchRow}
    />
  ) : null;

  const body = rail ? (
    <Splitter
      key={info.cacheId}
      className="jsonl-splitter"
      onResize={(sizes) => saveLeft(info.cacheId, sizes[0] ?? DEFAULT_LEFT_WIDTH)}
    >
      <Splitter.Panel
        defaultSize={loadLeft(info.cacheId)}
        min={220}
        max={560}
        className="jsonl-splitter__panel"
      >
        <div className="json-preview__rail">{rail}</div>
      </Splitter.Panel>
      <Splitter.Panel className="jsonl-splitter__panel">{detailElement}</Splitter.Panel>
    </Splitter>
  ) : (
    <div className="json-preview__single">{detailElement}</div>
  );

  return wrap(
    <>
      {body}
      <footer className="jsonl-bottombar">
        <div className="jsonl-bottombar__detail" ref={setActionsHost} />
      </footer>
    </>,
  );
}
