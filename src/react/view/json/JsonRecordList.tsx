import { useEffect } from "react";
import type { JsonRecordSummary } from "../../../common/jsonPreviewTypes.ts";
import { $t } from "../../i18n/i18nConfig.ts";
import { JSON_ROW_HEIGHT, useVirtualWindow } from "./jsonVirtual.ts";

interface Props {
  count: number;
  labels: Map<number, JsonRecordSummary>;
  selected: number;
  onSelect: (index: number) => void;
  onNeedRange: (start: number, end: number) => void;
}

function labelOf(summary: JsonRecordSummary | undefined): string {
  if (!summary) return "";
  return summary.label ?? summary.raw;
}

/** Left rail for array roots: one virtual row per record, index always visible. */
export default function JsonRecordList({ count, labels, selected, onSelect, onNeedRange }: Props) {
  const { ref, onScroll, start, end, totalHeight } = useVirtualWindow(count);

  useEffect(() => {
    if (count > 0) onNeedRange(start, end);
  }, [count, end, onNeedRange, start]);

  useEffect(() => {
    const element = ref.current;
    if (!element || count === 0) return;
    const top = selected * JSON_ROW_HEIGHT;
    const bottom = top + JSON_ROW_HEIGHT;
    if (top < element.scrollTop) element.scrollTop = top;
    else if (bottom > element.scrollTop + element.clientHeight) {
      element.scrollTop = bottom - element.clientHeight;
    }
  }, [count, ref, selected]);

  const select = (index: number) => {
    if (index < 0 || index >= count) return;
    onSelect(index);
    ref.current?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (count === 0) return;
    const page = Math.max(1, Math.floor((ref.current?.clientHeight ?? 0) / JSON_ROW_HEIGHT) - 1);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      select(Math.min(count - 1, selected + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      select(Math.max(0, selected - 1));
    } else if (event.key === "PageDown") {
      event.preventDefault();
      select(Math.min(count - 1, selected + page));
    } else if (event.key === "PageUp") {
      event.preventDefault();
      select(Math.max(0, selected - page));
    } else if (event.key === "Home") {
      event.preventDefault();
      select(0);
    } else if (event.key === "End") {
      event.preventDefault();
      select(count - 1);
    }
  };

  if (count === 0) {
    return <div className="jsonl-empty">{$t("json.noRecords")}</div>;
  }

  const rows = Array.from({ length: Math.max(0, end - start) }, (_, offset) => {
    const index = start + offset;
    const summary = labels.get(index);
    const active = index === selected;
    return (
      <div
        key={index}
        id={`json-record-${index}`}
        role="option"
        aria-selected={active}
        aria-posinset={index + 1}
        aria-setsize={count}
        className={`json-record${active ? " json-record--selected" : ""}${
          summary?.kind === "invalid" ? " json-record--invalid" : ""
        }${summary?.kind === "too-large" ? " json-record--warn" : ""}`}
        style={{
          position: "absolute",
          top: index * JSON_ROW_HEIGHT,
          left: 0,
          right: 0,
          height: JSON_ROW_HEIGHT,
        }}
        onClick={() => select(index)}
      >
        <span className="json-record__index">[{index}]</span>
        {summary ? (
          <span className="json-record__label">{labelOf(summary)}</span>
        ) : (
          <span className="json-record__pending">…</span>
        )}
      </div>
    );
  });

  return (
    <div
      ref={ref}
      className="json-record-list"
      role="listbox"
      tabIndex={0}
      aria-label={$t("json.records")}
      aria-activedescendant={`json-record-${selected}`}
      onScroll={onScroll}
      onKeyDown={onKeyDown}
    >
      <div style={{ height: totalHeight, position: "relative" }}>{rows}</div>
    </div>
  );
}
