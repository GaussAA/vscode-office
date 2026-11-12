import "./Entry.less";
import { CopyOutlined } from "@ant-design/icons";
import { $t } from "../../i18n/i18nConfig.ts";
import { Button, Modal, Segmented, Tree } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { DataNode } from "antd/es/tree";
import type { JsonlEntryDetail } from "../../../common/jsonlTypes.ts";
import { JSONL_MAX_LINE_BYTES } from "../../../common/jsonlTypes.ts";
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
} from "./entryFormat.ts";
import EntryValuePanel from "./EntryValuePanel.tsx";
import { chipClass, chipLabel, toAntdNodes } from "./entryTreeAdapter.tsx";
import { detailKeyAction } from "./entryKeys.ts";
import {
  collapsedChars,
  readActiveValue,
  readCopyPath,
  readPanel,
  readSelection,
} from "./entrySelection.ts";

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
  /** Search term to mark in keys and values. */
  highlight?: string;
  /** Key to expand, select and reveal after a search result is chosen. */
  revealKey?: string | null;
  /** Bumped when the same key is chosen again; a value-only reveal would bail out. */
  revealNonce?: number;
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

  // The model decides its own wrapping, so render no longer has to count first and then
  // build; small entries wrap (variable row height, virtual list off), big ones stay on one
  // line so the fixed-height virtual list keeps working.
  const model = useMemo(
    () => (entry?.kind === "value" ? buildEntryModel(entry.value) : null),
    [entry],
  );
  const wrap = model?.wrap ?? false;

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
   * The selection panel is the read channel for a value the single-line tree can only
   * abbreviate. `readSelection` owns the rules (scalar root, active key, labels); the full
   * text is built only when the panel opens, because stringifying a whole subtree for a bar
   * the user may never expand is the expensive half.
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

  /** One adapter build per entry/expansion change; it used to run on every render. */
  const treeData = useMemo<DataNode[]>(() => {
    if (!model) return [];
    const nodes = toAntdNodes(model.nodes, wrap, highlight);
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
  }, [model, wrap, highlight]);

  const copyValue = useCallback(() => {
    if (!entry) return;
    void copy(jsonText(activeValue()), "value");
  }, [entry, activeValue, copy]);

  const copyPath = useCallback(() => {
    if (!entry) return;
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
      {entry?.kind === "value" && (
        <>
          <Button size="small" type="text" onClick={expandAll}>
            {$t("jsonl.expandAll")}
          </Button>
          <Button size="small" type="text" onClick={collapseAll}>
            {$t("jsonl.collapseAll")}
          </Button>
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

  let body: React.ReactNode;
  if (!entry) {
    body = (
      <div className="jsonl-empty">{loading ? $t("jsonl.loading") : $t("jsonl.selectEntry")}</div>
    );
  } else if (mode === "raw") {
    body = (
      <div className="jsonl-detail__rawpane">
        {entry.textTruncated && (
          <div className="jsonl-detail__notice">
            {$t("jsonl.valueTruncated", {
              shown: entry.text.length.toLocaleString(),
              total: entry.textChars.toLocaleString(),
            })}
          </div>
        )}
        <pre className="jsonl-detail__raw">{entry.text}</pre>
      </div>
    );
  } else if (entry.kind === "empty") {
    body = <div className="jsonl-empty">{$t("jsonl.emptyLine")}</div>;
  } else if (entry.kind === "invalid") {
    body = (
      <div className="jsonl-detail__error">
        <div className="jsonl-chip jsonl-chip--error">{$t("jsonl.invalidJson")}</div>
        {entry.textTruncated && (
          <div className="jsonl-detail__notice">
            {$t("jsonl.valueTruncated", {
              shown: entry.text.length.toLocaleString(),
              total: entry.textChars.toLocaleString(),
            })}
          </div>
        )}
        <pre className="jsonl-detail__raw">{entry.text}</pre>
      </div>
    );
  } else if (entry.kind === "too-large") {
    body = (
      <div className="jsonl-detail__error">
        <div className="jsonl-chip jsonl-chip--warn">{$t("jsonl.tooLargeToParse")}</div>
        <div className="jsonl-detail__notice">
          {$t("jsonl.tooLargeHint", { limit: formatBytes(JSONL_MAX_LINE_BYTES) })}
        </div>
        {entry.textTruncated && (
          <div className="jsonl-detail__notice">
            {$t("jsonl.valueTruncated", {
              shown: entry.text.length.toLocaleString(),
              total: entry.textChars.toLocaleString(),
            })}
          </div>
        )}
        <pre className="jsonl-detail__raw">{entry.text}</pre>
      </div>
    );
  } else if (!isComposite(entry.value)) {
    body = (
      <div className="jsonl-detail__scalar">
        <span className="jsonl-type">{typeLabel(entry.value)}</span>
        <span className="jsonl-val">{entry.value === undefined ? "—" : preview(entry.value)}</span>
      </div>
    );
  } else if (model) {
    const tree = (
      <Tree
        className={`jsonl-detail__tree${wrap ? " jsonl-detail__tree--wrap" : ""}`}
        treeData={treeData}
        expandedKeys={expandedKeys}
        onExpand={(keys) => setExpanded(keys)}
        selectedKeys={activeKey ? [activeKey] : []}
        onSelect={(keys) => setActiveKey(keys.length ? String(keys[0]) : null)}
        {...(wrap ? {} : { height, itemHeight: ROW_HEIGHT, virtual: true })}
        showIcon={false}
      />
    );
    body = wrap ? <div className="jsonl-detail__scroll">{tree}</div> : tree;
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
