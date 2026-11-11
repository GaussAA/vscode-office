import { FileTextOutlined, ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import { Button, ConfigProvider, Input, Splitter, theme as antdTheme } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { JsonlEntryDetail } from "../../../common/jsonlTypes.ts";
import {
  JSON_MAX_ARRAY_BYTES,
  JSON_MAX_OBJECT_BYTES,
  JSON_RECORD_WINDOW,
  type JsonInfoPayload,
  type JsonRecordSummary,
  type JsonRootPayload,
  type JsonSearchBatch,
  type JsonSearchRecord,
} from "../../../common/jsonPreviewTypes.ts";
import { handler } from "../../util/vscode.ts";
import {
  getVscodeThemeColor,
  isVscodeDarkTheme,
  observeVscodeThemeChange,
} from "../../util/vscodeTheme.ts";
import { $t } from "../../i18n/i18nConfig.ts";
import JsonlDetail, { type DetailMode } from "../jsonl/JsonlDetail.tsx";
import { formatBytes } from "../jsonl/jsonlFormat.ts";
import JsonRecordList from "./JsonRecordList.tsx";
import JsonSearchRail, { type JsonSearchRow } from "./JsonSearchRail.tsx";
import { collectMatchPaths, firstMatchKey } from "./jsonPreviewFormat.ts";
import "../jsonl/Jsonl.less";
import "./JsonPreview.less";

const DEFAULT_LEFT_WIDTH = 340;
const LEFT_PREFIX = "json-preview:left:";
const SEARCH_DEBOUNCE_MS = 250;

interface SearchMeta {
  done: boolean;
  capped: boolean;
}

function loadLeft(cacheId: string): number {
  try {
    const value = Number(localStorage.getItem(LEFT_PREFIX + cacheId));
    return value >= 220 && value <= 560 ? value : DEFAULT_LEFT_WIDTH;
  } catch {
    return DEFAULT_LEFT_WIDTH;
  }
}

function saveLeft(cacheId: string, value: number): void {
  try {
    localStorage.setItem(LEFT_PREFIX + cacheId, String(value));
  } catch {
    // persistence is a convenience; never break the preview
  }
}

/** A command-opened, read-only JSON inspection surface. It is not a custom editor. */
export default function JsonPreview() {
  const [info, setInfo] = useState<JsonInfoPayload | null>(null);
  const [root, setRoot] = useState<JsonlEntryDetail | null>(null);
  const [selected, setSelected] = useState(0);
  const [detail, setDetail] = useState<JsonlEntryDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [labels, setLabels] = useState<Map<number, JsonRecordSummary>>(new Map());
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<JsonSearchRecord[]>([]);
  const [searchMeta, setSearchMeta] = useState<SearchMeta | null>(null);
  const [revealKey, setRevealKey] = useState<string | null>(null);
  const [mode, setMode] = useState<DetailMode>("tree");
  const [actionsHost, setActionsHost] = useState<HTMLDivElement | null>(null);
  const [dark, setDark] = useState(isVscodeDarkTheme);

  const infoRef = useRef<JsonInfoPayload | null>(null);
  const selectedRef = useRef(0);
  const queryRef = useRef("");
  const entrySeq = useRef(0);
  const recordsSeq = useRef(0);
  const searchSeq = useRef(0);
  const searchRequestId = useRef(0);
  const requestedWindows = useRef(new Set<number>());

  useEffect(() => observeVscodeThemeChange(() => setDark(isVscodeDarkTheme())), []);

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
      const requestId = ++recordsSeq.current;
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
    const requestId = ++entrySeq.current;
    setDetailLoading(true);
    handler.emit("jsonRecord", { requestId, index });
  }, []);

  useEffect(() => {
    const onInfo = (payload: JsonInfoPayload) => {
      infoRef.current = payload;
      requestedWindows.current = new Set();
      setInfo(payload);
      setLabels(new Map());
      setSelected(0);
      selectedRef.current = 0;
      setDetail(null);
      setRoot(null);
      setDetailLoading(payload.rootKind === "array");
      setRevealKey(null);
      setQuery("");
      queryRef.current = "";
      setResults([]);
      setSearching(false);
      setSearchMeta(null);
      if (payload.rootKind === "array") requestWindows(0, JSON_RECORD_WINDOW);
    };

    handler
      .on("jsonInfo", onInfo)
      .on("jsonRoot", (payload: JsonRootPayload) => {
        setRoot(payload.entry);
        setDetail(payload.entry);
        setDetailLoading(false);
      })
      .on("jsonRecordsData", (payload: { records?: JsonRecordSummary[] }) => {
        if (!payload.records?.length) return;
        setLabels((previous) => {
          const next = new Map(previous);
          for (const record of payload.records ?? []) next.set(record.index, record);
          return next;
        });
      })
      .on(
        "jsonRecordData",
        (payload: { requestId: number; index: number; entry: JsonlEntryDetail | null }) => {
          if (payload.requestId !== entrySeq.current) return;
          if (payload.index !== selectedRef.current) return;
          setDetail(payload.entry);
          setDetailLoading(false);
          const term = queryRef.current;
          setRevealKey(
            term && payload.entry?.kind === "value"
              ? firstMatchKey(payload.entry.value, term)
              : null,
          );
        },
      )
      .on("jsonSearchBatch", (batch: JsonSearchBatch) => {
        if (batch.requestId !== searchSeq.current) return;
        if (batch.records.length) {
          setResults((previous) => [...previous, ...batch.records]);
        }
        setSearchMeta({ done: batch.done, capped: batch.capped });
        if (batch.done) setSearching(false);
      });

    handler.emit("init");
  }, [requestWindows]);

  useEffect(() => {
    if (info?.rootKind !== "array") return;
    requestDetail(selected);
  }, [info, requestDetail, selected]);

  useEffect(() => {
    const term = query.trim();
    if (!term || infoRef.current?.rootKind !== "array") return;
    const timer = window.setTimeout(() => {
      const requestId = ++searchSeq.current;
      searchRequestId.current = requestId;
      handler.emit("jsonSearch", { requestId, query: term });
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  const searchActive = query.trim().length > 0;
  const arrayRoot = info?.rootKind === "array";
  const recordCount = info?.recordCount ?? 0;
  const pathResults = useMemo(() => {
    if (!searchActive || arrayRoot || !root || root.kind !== "value") return [];
    return collectMatchPaths(root.value, query.trim());
  }, [arrayRoot, query, root, searchActive]);

  const handleQueryChange = useCallback((value: string) => {
    const term = value.trim();
    setQuery(value);
    queryRef.current = term;
    searchSeq.current++;
    if (searchRequestId.current) {
      handler.emit("jsonSearchCancel", { requestId: searchRequestId.current });
      searchRequestId.current = 0;
    }
    setResults([]);
    setSearchMeta(null);
    setRevealKey(null);
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
    : (revealKey ?? undefined);

  const onSelectRecord = useCallback((index: number) => {
    setSelected(index);
    setRevealKey(null);
  }, []);

  const onSelectSearchRow = useCallback(
    (row: JsonSearchRow) => {
      if (row.index !== undefined) {
        const same = row.index === selectedRef.current;
        const term = queryRef.current;
        setSelected(row.index);
        setRevealKey(
          same && term && detail?.kind === "value" ? firstMatchKey(detail.value, term) : null,
        );
      } else {
        setRevealKey(row.key);
      }
    },
    [detail],
  );

  const openText = () => handler.emit("jsonOpenText");
  const reload = () => handler.emit("jsonReload");

  const themeTokens = {
    colorBgContainer: "transparent",
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
    fontFamily: getVscodeThemeColor(
      "--vscode-font-family",
      '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    ),
    fontSize: Number.parseInt(getVscodeThemeColor("--vscode-font-size", "13px"), 10) || 13,
    controlHeightSM: 22,
    borderRadius: 4,
  };

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

  const toolbar = (
    <div className="jsonl-toolbar">
      <div className="jsonl-toolbar__left">
        <span className="jsonl-file-name" title={info?.fileName}>
          {info?.fileName ?? "JSON"}
        </span>
        {meta && <span className="jsonl-meta">{meta}</span>}
        {info && (
          <>
            <span className="jsonl-dot">·</span>
            <span className="jsonl-meta">{formatBytes(info.byteSize)}</span>
          </>
        )}
        {info?.fromBuffer && <span className="json-buffer">{$t("json.fromBuffer")}</span>}
      </div>
      <div className="jsonl-toolbar__right">
        <Input
          size="small"
          allowClear
          prefix={<SearchOutlined />}
          placeholder={$t("json.searchRecords")}
          className="jsonl-search"
          value={query}
          disabled={!info || (info.rootKind !== "array" && info.rootKind !== "object")}
          onChange={(event) => handleQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              handleQueryChange("");
            }
          }}
        />
        {searchStatus}
        <Button
          type="text"
          size="small"
          icon={<ReloadOutlined />}
          aria-label={$t("jsonl.reload")}
          title={$t("jsonl.reload")}
          onClick={reload}
        />
        <Button
          type="text"
          size="small"
          icon={<FileTextOutlined />}
          aria-label={$t("json.openText")}
          title={$t("json.openText")}
          onClick={openText}
        />
      </div>
    </div>
  );

  const wrap = (body: React.ReactNode) => (
    <ConfigProvider
      theme={{
        algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        token: themeTokens,
      }}
    >
      <div className={`jsonl-viewer json-preview${dark ? "" : " jsonl-viewer--light"}`}>
        {toolbar}
        {body}
      </div>
    </ConfigProvider>
  );

  if (!info) {
    return wrap(
      <div className="json-preview__state">
        <span>{$t("jsonl.loading")}</span>
      </div>,
    );
  }

  if (info.rootKind === "invalid") {
    return wrap(
      <div className="json-preview__state">
        <div className="json-preview__state-title">{$t("jsonl.invalidJson")}</div>
        <p>
          {info.error?.message}
          {info.error
            ? ` · ${$t("json.lineColumn", { line: info.error.line, column: info.error.column })}`
            : ""}
        </p>
        <Button onClick={openText}>{$t("json.openText")}</Button>
      </div>,
    );
  }

  if (info.rootKind === "too-large") {
    return wrap(
      <div className="json-preview__state">
        <div className="json-preview__state-title">{$t("json.tooLarge")}</div>
        <p>
          {$t("json.tooLargeHint", {
            array: formatBytes(JSON_MAX_ARRAY_BYTES),
            object: formatBytes(JSON_MAX_OBJECT_BYTES),
          })}
        </p>
        <Button onClick={openText}>{$t("json.openText")}</Button>
      </div>,
    );
  }

  if (arrayRoot && recordCount === 0) {
    return wrap(
      <div className="json-preview__state">
        <div className="json-preview__state-title">{$t("json.noRecords")}</div>
        <Button onClick={openText}>{$t("json.openText")}</Button>
      </div>,
    );
  }

  const detailElement = (
    <JsonlDetail
      key={arrayRoot ? `record-${selected}` : "root"}
      index={arrayRoot ? selected : 0}
      entry={arrayRoot ? detail : root}
      loading={arrayRoot ? detailLoading : !root}
      mode={mode}
      onModeChange={setMode}
      actionsHost={actionsHost}
      entryLabel={arrayRoot ? `[${selected}]` : "root"}
      highlight={searchActive ? query.trim() : undefined}
      revealKey={revealKey}
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
      key={`${info.cacheId}:${searchActive ? "search" : "records"}`}
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
