import type { DataNode } from "antd/es/tree";
import { $t } from "../../i18n/i18nConfig.ts";
import { highlightRuns } from "../../common/highlight.ts";
import type { JsonlEntryDetail } from "../../../common/jsonlTypes.ts";
import { isEmptyComposite, preview, typeLabel, type NodeModel } from "./entryFormat";

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

export function toAntdNodes(
  nodes: NodeModel[],
  highlight?: string,
  loaded?: Map<string, NodeModel[]>,
): DataNode[] {
  return nodes.map((node) => {
    if (node.overflow !== undefined) {
      return {
        key: node.key,
        isLeaf: true,
        selectable: false,
        title: <span className="jsonl-more">{$t("jsonl.moreKeys", { count: node.overflow })}</span>,
      };
    }
    // A lazy node gets its children from the loaded map once `loadData` has built them; the
    // DataNode itself is re-created on that state change, because rc-tree keeps entities
    // converted from the old treeData and would not notice an in-place mutation.
    const childModels = node.lazy ? loaded?.get(String(node.key)) : node.children;
    // `[]` and `{}` have nothing to reveal, so they must not advertise an expand arrow.
    const empty = node.composite && isEmptyComposite(node.value);
    // Loaded lazy children carry previews built at load time. While a search is active,
    // recompute every summary so a hit inside an expanded subtree is marked and centred.
    const summary = highlight ? preview(node.value, highlight) : node.preview;
    return {
      key: node.key,
      isLeaf: !node.composite || empty,
      children:
        node.composite && !empty && childModels
          ? toAntdNodes(childModels, highlight, loaded)
          : undefined,
      ...(node.lazy ? { dataRef: node } : {}),
      title: (
        <span className="jsonl-kv">
          <span className="jsonl-key">{renderHighlighted(node.label, highlight)}</span>
          <span className="jsonl-colon">:</span>
          <span className={`jsonl-val jsonl-val--${node.kind}`}>
            {renderHighlighted(summary, highlight)}
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
