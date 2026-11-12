import type { DataNode } from "antd/es/tree";
import { $t } from "../../i18n/i18nConfig.ts";
import { highlightRuns } from "../../common/highlight.ts";
import type { JsonlEntryDetail } from "../../../common/jsonlTypes.ts";
import { typeLabel, type NodeModel } from "./jsonlFormat";

export function chipClass(entry: JsonlEntryDetail): string {
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

export function chipLabel(entry: JsonlEntryDetail): string {
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
function renderHighlighted(text: string, highlight?: string): React.ReactNode {
  if (!highlight) return text;
  return highlightRuns(text, highlight).map((part, index) =>
    part.hit ? (
      <mark key={index} className="jsonl-hit">
        {part.text}
      </mark>
    ) : (
      <span key={index}>{part.text}</span>
    ),
  );
}

export function toAntdNodes(nodes: NodeModel[], wrap: boolean, highlight?: string): DataNode[] {
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
      children: node.composite ? toAntdNodes(node.children, wrap, highlight) : undefined,
      title: (
        <span className={`jsonl-kv${wrap ? " jsonl-kv--wrap" : ""}`}>
          <span className="jsonl-key">{renderHighlighted(node.label, highlight)}</span>
          <span className="jsonl-colon">:</span>
          <span
            className={`jsonl-val jsonl-val--${node.kind}${longString ? " jsonl-val--wrap" : ""}`}
          >
            {renderHighlighted(node.preview, highlight)}
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
