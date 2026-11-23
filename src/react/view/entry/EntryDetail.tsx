import "./Entry.less";
import { CopyOutlined } from "@ant-design/icons";
import { $t } from "../../i18n/i18nConfig.ts";
import { Button, ConfigProvider, Modal, Segmented, Tree } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { DataNode } from "antd/es/tree";
import type { JsonlEntryDetail } from "../../../common/jsonlTypes.ts";
import { JSONL_MAX_LINE_BYTES } from "../../../common/jsonlTypes.ts";
import { SUMMARY_CHARS } from "../../../common/recordConstants.ts";
import {
  AUTO_EXPAND_LIMIT,
  EXPAND_ALL_CONFIRM,
  ROW_HEIGHT,
  buildEntryModel,
  formatBytes,
  isComposite,
  jsonText,
  makePathKey,
  preview,
  readPathKey,
  typeLabel,
  type NodeModel,
} from "./entryFormat.ts";
import EntryValuePanel from "./EntryValuePanel.tsx";
import { chipClass, chipLabel, toAntdNodes } from "./entryTreeAdapter.tsx";
import { detailKeyAction } from "./entryKeys.ts";
import {
  collapsedChars,
  rawSummary,
  readActiveValue,
  readCopyPath,
  readPanel,
  readSelection,
} from "./entrySelection.ts";
import { MOTION_BASE_MS, MOTION_FAST_MS, motionEnabled } from "../../util/motion.ts";

export type DetailMode = "tree" | "raw";

interface Props {
  index: number;
  entry: JsonlEntryDetail | null;
  loading: boolean;
  mode: DetailMode;
  onModeChange: (mode: DetailMode) => void;
  /** The bottom bar owns the row; the detail's identity and actions portal into it. */
  actionsHost: HTMLElement | null;
  /** Row prefix; JSONL defaults to `L<n>`, JSON preview passes `[n]` or `root`. */
  entryLabel?: string;
  /** Search term to mark in keys and values; long-string summaries are centred on it. */
  highlight?: string;
  /** Key to expand, select and reveal after a search result is chosen. */
  revealKey?: string | null;
  /** Bumped when the same key is chosen again; a value-only reveal would bail out. */
  revealNonce?: number;
  /**
   * Called when the raw text is needed but the detail payload did not carry it (ADR-0030:
   * the host ships the value, and the raw line only when asked).
   */
  onRequestText?: () => void;
}

/** Right pane: the full tree (or raw text) of exactly one entry. */
export default function EntryDetail({
  index,
  entry,
  loading,
  mode,
  onModeChange,
  actionsHost,
  entryLabel,
  highlight,
  revealKey,
  revealNonce,
  onRequestText,
}: Props) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const copyTimer = useRef(0);
  const [height, setHeight] = useState(320);
  /**
   * null means "follow the default expansion for this entry"; the first toggle pins an
   * explicit set. The pane is keyed by entry index, so switching entries remounts it and
   * both this and `activeKey` fall back to their defaults.
   */
  const [expanded, setExpanded] = useState<React.Key[] | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [copied, setCopied] = useState<"value" | "path" | null>(null);
  /** The selection panel under the tree; collapsed by default so the tree keeps its height. */
  const [valueOpen, setValueOpen] = useState(false);

  // The model decides its own depth budget, so render no longer has to count first and then
  // build. A search reveal needs the whole path, so it is eager.
  const model = useMemo(
    () =>
      entry?.kind === "value"
        ? buildEntryModel(entry.value, {
            lazyDepth: revealKey ? Number.POSITIVE_INFINITY : entry.size > 200_000 ? 2 : 3,
            ...(highlight ? { highlight } : {}),
          })
        : null,
    [entry, revealKey, highlight],
  );

  const defaultExpanded = useMemo<React.Key[]>(() => {
    if (!model) return [];
    return model.count <= AUTO_EXPAND_LIMIT ? model.keys : model.shallowKeys;
  }, [model]);
  const expandedKeys = expanded ?? defaultExpanded;

  // A search result points at a key; expand its ancestors and select it. The record is keyed
  // by index in the JSON preview, so this runs once per selected record/reveal.
  useEffect(() => {
    if (!revealKey || !model) return;
    const segments = readPathKey(revealKey);
    const ancestors = segments
      .slice(1)
      .map((_, position) => makePathKey(segments.slice(0, position + 1)));
    // eslint-disable-next-line react/set-state-in-effect -- a reveal must expand its ancestors
    setExpanded((previous) =>
      Array.from(new Set([...(previous ?? defaultExpanded), ...ancestors, revealKey])),
    );
    setActiveKey(revealKey);
  }, [defaultExpanded, model, revealKey, revealNonce]);

  // The host ships the value, not the raw line: ask for the text the first time it is needed.
  const textMissing = entry !== null && entry.kind === "value" && !entry.textIncluded;
  const textRequested = useRef(false);
  useEffect(() => {
    if (mode !== "raw" || !textMissing || textRequested.current) return;
    textRequested.current = true;
    onRequestText?.();
  }, [mode, textMissing, onRequestText]);

  useEffect(() => {
    // Measure the tree's own box, not the pane: the value bar takes height from the pane and
    // a virtual list sized to the pane would draw rows underneath it.
    const element = bodyRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setHeight(Math.max(120, element.clientHeight)));
    observer.observe(element);
    setHeight(Math.max(120, element.clientHeight));
    return () => observer.disconnect();
  }, []);

  useEffect(() => () => window.clearTimeout(copyTimer.current), []);

  const flash = useCallback((kind: "value" | "path") => {
    setCopied(kind);
    window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopied(null), 1200);
  }, []);

  const copy = useCallback(
    async (text: string, kind: "value" | "path") => {
      try {
        await navigator.clipboard.writeText(text);
        flash(kind);
      } catch {
        // clipboard unavailable; ignore
      }
    },
    [flash],
  );

  const activeValue = useCallback(() => readActiveValue(entry, activeKey), [entry, activeKey]);

  /**
   * The selection panel is the only full-text channel (ADR-0030). `readSelection` owns the
   * rules (root fallback, error lines, active key, labels); the full text is built only when
   * the panel opens, because stringifying a whole subtree for a bar the user may never expand
   * is the expensive half.
   */
  const selection = useMemo(
    () => readSelection(entry, activeKey, index, entryLabel),
    [entry, activeKey, index, entryLabel],
  );
  const panelText = useMemo(
    () => (valueOpen && selection ? readPanel(selection) : null),
    [valueOpen, selection],
  );
  const valueChars = panelText?.chars ?? (selection ? collapsedChars(selection) : null);

  /** Says what was cut, whichever budget cut it: the panel's or the host's text cap. */
  const panelNotice = useMemo(() => {
    if (!selection || !panelText) return null;
    if (panelText.truncated) {
      return $t("jsonl.valueTruncated", {
        shown: panelText.text.length.toLocaleString(),
        total: panelText.chars.toLocaleString(),
      });
    }
    if (selection.source === "text" && entry?.textTruncated) {
      return $t("jsonl.valueTruncated", {
        shown: entry.text.length.toLocaleString(),
        total: entry.textChars.toLocaleString(),
      });
    }
    return null;
  }, [entry, panelText, selection]);

  /** One adapter build per entry/expansion change; it used to run on every render. */
  const treeData = useMemo<DataNode[]>(() => {
    if (!model) return [];
    const nodes = toAntdNodes(model.nodes, highlight);
    if (model.truncated) {
      nodes.push({
        key: "__truncated__",
        isLeaf: true,
        selectable: false,
        title: (
          <span className="jsonl-more">
            {$t("jsonl.treeTruncated", { count: model.limit.toLocaleString() })}
          </span>
        ),
      });
    }
    return nodes;
  }, [model, highlight]);

  const loadData = useCallback(
    async (node: DataNode) => {
      const source = (node as DataNode & { dataRef?: NodeModel }).dataRef;
      if (!source?.lazy) return;
      // Yield once so the expand spinner paints before building this node's children.
      await Promise.resolve();
      const built = buildEntryModel(source.value, {
        lazyDepth: 1,
        ...(highlight ? { highlight } : {}),
      });
      node.children = toAntdNodes(built.nodes, highlight);
    },
    [highlight],
  );

  const onExpand = useCallback((keys: React.Key[]) => setExpanded(keys), []);
  const onSelect = useCallback(
    (keys: React.Key[]) => setActiveKey(keys.length ? String(keys[0]) : null),
    [],
  );

  // Opening the value panel flips `valueOpen` in this component. Without this memo, that
  // re-rendered every memoized tree node for a 1.3 MB object just to show a panel; with it,
  // only the panel subtree updates.
  const tree = useMemo(
    () => (
      <ConfigProvider
        theme={{
          // Expand/collapse is instant on purpose: a 20k-node tree re-flows on every expand and
          // the frame gate (`jsonl-frames-expand`) treats motion there as a regression.
          token: {
            motion: motionEnabled(),
            motionDurationMid: motionEnabled() ? `${MOTION_BASE_MS / 1000}s` : "0s",
            motionDurationFast: motionEnabled() ? `${MOTION_FAST_MS / 1000}s` : "0s",
          },
        }}
      >
        <Tree
          className="jsonl-detail__tree"
          treeData={treeData}
          expandedKeys={expandedKeys}
          onExpand={onExpand}
          selectedKeys={activeKey ? [activeKey] : []}
          onSelect={onSelect}
          loadData={loadData}
          height={height}
          itemHeight={ROW_HEIGHT}
          virtual
          showIcon={false}
        />
      </ConfigProvider>
    ),
    [treeData, expandedKeys, height, activeKey, onExpand, onSelect, loadData],
  );

  const copyValue = useCallback(() => {
    if (!entry) return;
    void copy(jsonText(activeValue()), "value");
  }, [entry, activeValue, copy]);

  const copyPath = useCallback(() => {
    void copy(readCopyPath(entry, activeKey, index, entryLabel), "path");
  }, [entry, activeKey, index, entryLabel, copy]);

  const expandAll = useCallback(() => {
    if (!model) return;
    if (model.count > EXPAND_ALL_CONFIRM) {
      Modal.confirm({
        title: $t("jsonl.expandAllConfirmTitle"),
        content: $t("jsonl.expandAllConfirmBody", {
          count: `${model.count}${model.truncated ? "+" : ""}`,
        }),
        okText: $t("jsonl.expandAll"),
        cancelText: $t("common.cancel"),
        onOk: () => setExpanded(model.keys),
      });
      return;
    }
    setExpanded(model.keys);
  }, [model]);

  const collapseAll = useCallback(() => setExpanded([]), []);

  const mutateExpansion = useCallback(
    (update: (keys: React.Key[]) => React.Key[]) => {
      setExpanded(update(expandedKeys));
    },
    [expandedKeys],
  );

  const toggleValue = useCallback(() => {
    if (!selection) return;
    setValueOpen((open) => !open);
  }, [selection]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      // The value toggle, the segmented control and the panel's own scroll area are real
      // controls; the keymap lets them handle Enter/Space/arrows themselves or the panel
      // would open and immediately close. Copy stays ahead of that guard.
      const target = event.target;
      const onControl =
        target instanceof Element &&
        !!target.closest("button, input, textarea, [role=radio], .jsonl-valuebar__body");
      const nativeText =
        target instanceof Element && !!target.closest("input, textarea, .jsonl-valuebar__body");
      const action = detailKeyAction({
        key: event.key,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        defaultPrevented: event.defaultPrevented,
        onControl,
        nativeText,
        hasSelection: !!selection,
        panelOpen: valueOpen,
        hasActiveKey: !!activeKey,
      });
      switch (action.type) {
        case "close-panel":
          event.preventDefault();
          setValueOpen(false);
          // The panel's scroll area is unmounted here; leaving focus on <body> would strand
          // a keyboard user at the top of the document.
          toggleRef.current?.focus();
          return;
        case "copy":
          event.preventDefault();
          if (action.target === "path") copyPath();
          else copyValue();
          return;
        case "toggle-panel":
          event.preventDefault();
          toggleValue();
          return;
        case "expand":
        case "collapse":
        case "toggle-expand": {
          if (!activeKey) return;
          event.preventDefault();
          mutateExpansion((keys) => {
            const open = keys.includes(activeKey);
            if (action.type === "expand") return open ? keys : [...keys, activeKey];
            if (action.type === "collapse") return keys.filter((key) => key !== activeKey);
            return open ? keys.filter((key) => key !== activeKey) : [...keys, activeKey];
          });
          return;
        }
        case "ignore":
          return;
      }
    },
    [activeKey, copyPath, copyValue, mutateExpansion, selection, toggleValue, valueOpen],
  );

  const header = (
    <div className="jsonl-detail__header">
      {(entry || loading) && (
        <span className="jsonl-detail__index">{entryLabel ?? `L${index + 1}`}</span>
      )}
      {entry && (
        <span className={`jsonl-chip jsonl-chip--${chipClass(entry)}`}>{chipLabel(entry)}</span>
      )}
      {entry && <span className="jsonl-meta">{formatBytes(entry.size)}</span>}
      <span className="jsonl-detail__spacer" />
      {entry?.kind === "value" && model && (
        <>
          <Button size="small" type="text" onClick={expandAll}>
            {$t("jsonl.expandAll")}
          </Button>
          <Button size="small" type="text" onClick={collapseAll}>
            {$t("jsonl.collapseAll")}
          </Button>
        </>
      )}
      {entry && entry.kind !== "empty" && (
        <>
          <Button size="small" type="text" icon={<CopyOutlined />} onClick={copyValue}>
            {copied === "value" ? $t("common.copied") : $t("jsonl.value")}
          </Button>
          <Button size="small" type="text" onClick={copyPath}>
            {copied === "path" ? $t("common.copied") : $t("jsonl.path")}
          </Button>
        </>
      )}
      <Segmented
        size="small"
        value={mode}
        disabled={!entry}
        onChange={(value) => onModeChange(value as DetailMode)}
        options={[
          { label: $t("jsonl.tree"), value: "tree" },
          { label: $t("jsonl.raw"), value: "raw" },
        ]}
      />
    </div>
  );

  const rawView = useMemo(() => {
    if (!entry) return null;
    const summary = rawSummary(entry);
    const shown = summary.text.length;
    return (
      <div className="jsonl-detail__rawpane">
        {(summary.truncated || entry.textTruncated) && (
          <div className="jsonl-detail__notice">
            {$t("jsonl.valueTruncated", {
              shown: shown.toLocaleString(),
              total: entry.textChars.toLocaleString(),
            })}
          </div>
        )}
        <pre className="jsonl-detail__raw">{summary.text}</pre>
      </div>
    );
  }, [entry]);

  let body: React.ReactNode;
  if (!entry) {
    body = (
      <div className="jsonl-empty">{loading ? $t("jsonl.loading") : $t("jsonl.selectEntry")}</div>
    );
  } else if (entry.kind === "empty") {
    body = <div className="jsonl-empty">{$t("jsonl.emptyLine")}</div>;
  } else if (mode === "raw") {
    body = textMissing ? <div className="jsonl-empty">{$t("jsonl.loading")}</div> : rawView;
  } else if (entry.kind === "invalid") {
    body = (
      <div className="jsonl-detail__error">
        <div className="jsonl-chip jsonl-chip--error">{$t("jsonl.invalidJson")}</div>
        <div className="jsonl-detail__notice">
          {textMissing ? $t("jsonl.loading") : $t("jsonl.summaryOnly", { chars: SUMMARY_CHARS })}
        </div>
        <pre className="jsonl-detail__raw">{textMissing ? "" : rawSummary(entry).text}</pre>
      </div>
    );
  } else if (entry.kind === "too-large") {
    body = (
      <div className="jsonl-detail__error">
        <div className="jsonl-chip jsonl-chip--warn">{$t("jsonl.tooLargeToParse")}</div>
        <div className="jsonl-detail__notice">
          {$t("jsonl.tooLargeHint", { limit: formatBytes(JSONL_MAX_LINE_BYTES) })}
        </div>
        <div className="jsonl-detail__notice">
          {textMissing ? $t("jsonl.loading") : $t("jsonl.summaryOnly", { chars: SUMMARY_CHARS })}
        </div>
        <pre className="jsonl-detail__raw">{textMissing ? "" : rawSummary(entry).text}</pre>
      </div>
    );
  } else if (!isComposite(entry.value)) {
    body = (
      <div className="jsonl-detail__scalar">
        <span className="jsonl-type">{typeLabel(entry.value)}</span>
        <span className="jsonl-val">
          {entry.value === undefined ? "—" : preview(entry.value, highlight)}
        </span>
      </div>
    );
  } else if (model) {
    body = tree;
  } else {
    body = <div className="jsonl-empty">{$t("jsonl.noTree")}</div>;
  }

  const valuePanel = selection ? (
    <EntryValuePanel
      path={selection.panelPath}
      preview={selection.preview}
      typeLabel={selection.typeLabel}
      chars={valueChars}
      open={valueOpen}
      panel={panelText}
      notice={panelNotice}
      toggleRef={toggleRef}
      onToggle={toggleValue}
    />
  ) : null;

  return (
    <div className="jsonl-detail" tabIndex={-1} onKeyDown={onKeyDown}>
      {actionsHost ? createPortal(header, actionsHost) : null}
      <div className="jsonl-detail__body" ref={bodyRef}>
        {body}
      </div>
      {valuePanel}
    </div>
  );
}
