import { CopyOutlined } from "@ant-design/icons";
import { $t } from "../../i18n/i18nConfig.ts";
import { Button, Modal, Segmented, Tree } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { JsonlEntryDetail } from "../../../common/jsonlTypes.ts";
import { JSONL_MAX_LINE_BYTES, JSONL_VALUE_TEXT_LIMIT } from "../../../common/jsonlTypes.ts";
import type { DataNode } from "antd/es/tree";
import {
  AUTO_EXPAND_LIMIT,
  EXPAND_ALL_CONFIRM,
  ROW_HEIGHT,
  buildEntryModel,
  formatBytes,
  fullValueText,
  isComposite,
  jsonText,
  pathToText,
  preview,
  readPathKey,
  typeLabel,
  valueAtPath,
  type NodeModel,
} from "./jsonlFormat.ts";

export type DetailMode = "tree" | "raw";

interface Props {
  index: number;
  entry: JsonlEntryDetail | null;
  loading: boolean;
  mode: DetailMode;
  onModeChange: (mode: DetailMode) => void;
  /** The bottom bar owns the row; the detail's identity and actions portal into it. */
  actionsHost: HTMLElement | null;
}

function chipClass(entry: JsonlEntryDetail): string {
  switch (entry.kind) {
    case "empty":
      return "empty";
    case "invalid":
      return "error";
    case "too-large":
      return "warn";
    default:
      return "type";
  }
}

function chipLabel(entry: JsonlEntryDetail): string {
  switch (entry.kind) {
    case "empty":
      return $t("jsonl.chipEmpty");
    case "invalid":
      return $t("jsonl.invalidJson");
    case "too-large":
      return $t("jsonl.chipTooLarge");
    default:
      return typeLabel(entry.value);
  }
}

/** The only adapter between the tree model and antd. */
function toAntdNodes(nodes: NodeModel[], wrap: boolean): DataNode[] {
  return nodes.map((node) => {
    if (node.overflow !== undefined) {
      return {
        key: node.key,
        isLeaf: true,
        selectable: false,
        title: <span className="jsonl-more">{$t("jsonl.moreKeys", { count: node.overflow })}</span>,
      };
    }
    const longString = wrap && typeof node.value === "string";
    return {
      key: node.key,
      isLeaf: !node.composite,
      children: node.composite ? toAntdNodes(node.children, wrap) : undefined,
      title: (
        <span className={`jsonl-kv${wrap ? " jsonl-kv--wrap" : ""}`}>
          <span className="jsonl-key">{node.label}</span>
          <span className="jsonl-colon">:</span>
          <span
            className={`jsonl-val jsonl-val--${node.kind}${longString ? " jsonl-val--wrap" : ""}`}
          >
            {node.preview}
          </span>
          {node.composite && <span className="jsonl-type">{node.typeLabel}</span>}
          {node.depthCapped !== undefined && (
            <span className="jsonl-more"> {$t("jsonl.moreKeys", { count: node.depthCapped })}</span>
          )}
        </span>
      ),
    };
  });
}

/** Right pane: the full tree (or raw text) of exactly one entry. */
export default function JsonlDetail({
  index,
  entry,
  loading,
  mode,
  onModeChange,
  actionsHost,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const toggleRef = useRef<HTMLButtonElement | null>(null);
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

  const flash = useCallback((kind: "value" | "path") => {
    setCopied(kind);
    window.setTimeout(() => setCopied(null), 1200);
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

  const activeValue = useCallback(() => {
    if (entry?.kind !== "value") return undefined;
    if (!activeKey) return entry.value;
    return valueAtPath(entry.value, readPathKey(activeKey));
  }, [entry, activeKey]);

  /**
   * The selection panel is the read channel for a value the single-line tree can only
   * abbreviate. It is the same idea as the parquet inspector, but inline: a modal would
   * interrupt a task that is literally "read this value and compare it with the next one".
   *
   * A scalar root has no tree row to select, so it is always "selected"; otherwise the panel
   * waits for a row. The full text is built only when the panel opens — computing it on every
   * selection would stringify a whole subtree for a bar the user may never expand.
   */
  const scalarRoot = entry?.kind === "value" && !isComposite(entry.value);
  const selectedValue = useMemo(() => {
    if (entry?.kind !== "value") return null;
    if (!activeKey && !scalarRoot) return null;
    return {
      value: activeKey ? valueAtPath(entry.value, readPathKey(activeKey)) : entry.value,
      path: activeKey ? pathToText(readPathKey(activeKey)) : `L${index + 1}`,
    };
  }, [entry, activeKey, index, scalarRoot]);
  const panelText = useMemo(
    () => (valueOpen && selectedValue ? fullValueText(selectedValue.value) : null),
    [valueOpen, selectedValue],
  );
  const selectedPreview = useMemo(() => {
    if (!selectedValue) return "";
    if (isComposite(selectedValue.value)) return preview(selectedValue.value);
    const source =
      typeof selectedValue.value === "string" ? selectedValue.value : String(selectedValue.value);
    const firstLine = (source.slice(0, 400).trimStart().split("\n", 1)[0] ?? "").trim();
    return firstLine.length > 160 ? `${firstLine.slice(0, 160)}…` : firstLine;
  }, [selectedValue]);
  // A string's length is free; everything else needs the pretty-printed text, so the count
  // appears only after the panel has been opened.
  const valueChars =
    panelText?.chars ??
    (typeof selectedValue?.value === "string" ? selectedValue.value.length : null);

  /** One adapter build per entry/expansion change; it used to run on every render. */
  const treeData = useMemo<DataNode[]>(() => {
    if (!model) return [];
    const nodes = toAntdNodes(model.nodes, wrap);
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
  }, [model, wrap]);

  const copyValue = useCallback(() => {
    if (!entry) return;
    void copy(jsonText(activeValue()), "value");
  }, [entry, activeValue, copy]);

  const copyPath = useCallback(() => {
    if (!entry) return;
    const text = activeKey
      ? `L${index + 1} › ${pathToText(readPathKey(activeKey))}`
      : `L${index + 1}`;
    void copy(text, "path");
  }, [entry, activeKey, index, copy]);

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
    if (!selectedValue) return;
    setValueOpen((open) => !open);
  }, [selectedValue]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      // The value toggle, the segmented control and the panel's own scroll area are real
      // controls; let them handle Enter/Space/arrows themselves or the panel would open and
      // immediately close, and arrow keys would expand the tree instead of scrolling text.
      const target = event.target;
      const onControl =
        target instanceof Element &&
        !!target.closest("button, input, textarea, [role=radio], .jsonl-valuebar__body");
      const nativeText =
        target instanceof Element && !!target.closest("input, textarea, .jsonl-valuebar__body");
      if (event.key === "Escape" && valueOpen) {
        event.preventDefault();
        setValueOpen(false);
        // The panel's scroll area is unmounted here; leaving focus on <body> would strand a
        // keyboard user at the top of the document.
        toggleRef.current?.focus();
        return;
      }
      // rc-tree handles Arrow/Enter/Space on its focused rows and calls preventDefault.
      // Running our expansion/toggle after that is the double-handling this guard removes.
      if (event.defaultPrevented) return;
      // Copy works from the toggle and the segmented control too, not only from the tree;
      // inputs and the panel's text keep the browser's own copy.
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c" && !nativeText) {
        event.preventDefault();
        if (event.shiftKey) copyPath();
        else copyValue();
        return;
      }
      if (onControl) return;
      if (selectedValue && event.key === "Enter") {
        event.preventDefault();
        toggleValue();
        return;
      }
      if (activeKey) {
        if (event.key === "ArrowRight") {
          event.preventDefault();
          mutateExpansion((keys) => (keys.includes(activeKey) ? keys : [...keys, activeKey]));
          return;
        }
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          mutateExpansion((keys) => keys.filter((key) => key !== activeKey));
          return;
        }
        if (event.key === " " || event.key === "Spacebar") {
          event.preventDefault();
          mutateExpansion((keys) =>
            keys.includes(activeKey)
              ? keys.filter((key) => key !== activeKey)
              : [...keys, activeKey],
          );
          return;
        }
      }
    },
    [activeKey, copyPath, copyValue, mutateExpansion, selectedValue, toggleValue, valueOpen],
  );

  const header = (
    <div className="jsonl-detail__header">
      {(entry || loading) && <span className="jsonl-detail__index">L{index + 1}</span>}
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

  const valuePanel = selectedValue ? (
    <div className={`jsonl-valuebar${valueOpen ? " jsonl-valuebar--open" : ""}`}>
      <button
        ref={toggleRef}
        type="button"
        className="jsonl-valuebar__toggle"
        aria-expanded={valueOpen}
        aria-label={valueOpen ? $t("jsonl.hideValue") : $t("jsonl.showValue")}
        onClick={() => setValueOpen((open) => !open)}
        title={valueOpen ? $t("jsonl.hideValue") : $t("jsonl.showValue")}
      >
        <span className="jsonl-valuebar__path">{selectedValue.path}</span>
        <span className="jsonl-valuebar__preview">{selectedPreview || "—"}</span>
        {valueChars !== null && valueChars !== 1 && (
          <span className="jsonl-valuebar__count">
            {typeLabel(selectedValue.value)} ·{" "}
            {$t("jsonl.valueChars", { count: valueChars.toLocaleString() })}
          </span>
        )}
        <span
          className={`codicon ${valueOpen ? "codicon-chevron-down" : "codicon-chevron-up"}`}
          aria-hidden="true"
        />
      </button>
      {valueOpen && panelText && (
        <div className="jsonl-valuebar__body">
          {panelText.truncated && (
            <div className="jsonl-valuebar__notice">
              {$t("jsonl.valueTruncated", {
                shown: JSONL_VALUE_TEXT_LIMIT.toLocaleString(),
                total: panelText.chars.toLocaleString(),
              })}
            </div>
          )}
          <pre className="jsonl-valuebar__text" tabIndex={0}>
            {panelText.text}
          </pre>
        </div>
      )}
    </div>
  ) : null;

  return (
    <div className="jsonl-detail" ref={containerRef} tabIndex={-1} onKeyDown={onKeyDown}>
      {actionsHost ? createPortal(header, actionsHost) : null}
      <div className="jsonl-detail__body" ref={bodyRef}>
        {body}
      </div>
      {valuePanel}
    </div>
  );
}
