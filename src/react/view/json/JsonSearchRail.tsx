import { useEffect } from "react";
import { highlightRuns } from "../../common/highlight.ts";
import { $t } from "../../i18n/i18nConfig.ts";
import { JSON_ROW_HEIGHT, useVirtualWindow } from "./jsonVirtual.ts";

export interface JsonSearchRow {
  key: string;
  /** Array results have an index; object-root results have a path. */
  index?: number;
  path?: string;
  snippet: string;
  count?: number;
}

interface Props {
  rows: JsonSearchRow[];
  selectedKey?: string;
  query: string;
  loading: boolean;
  onSelect: (row: JsonSearchRow) => void;
}

function marked(text: string, query: string) {
  return highlightRuns(text, query).map((part, index) =>
    part.hit ? (
      <mark key={index} className="jsonl-hit">
        {part.text}
      </mark>
    ) : (
      <span key={index}>{part.text}</span>
    ),
  );
}

/** Search results replace the record rail; one row per matching record (or path). */
export default function JsonSearchRail({ rows, selectedKey, query, loading, onSelect }: Props) {
  const { ref, onScroll, start, end, totalHeight } = useVirtualWindow(rows.length);
  const selectedIndex = rows.findIndex((row) => row.key === selectedKey);

  useEffect(() => {
    const element = ref.current;
    if (!element || !selectedKey) return;
    if (selectedIndex < 0) return;
    const top = selectedIndex * JSON_ROW_HEIGHT;
    if (top < element.scrollTop) element.scrollTop = top;
    else if (top + JSON_ROW_HEIGHT > element.scrollTop + element.clientHeight) {
      element.scrollTop = top + JSON_ROW_HEIGHT - element.clientHeight;
    }
  }, [ref, rows, selectedIndex, selectedKey]);

  if (rows.length === 0) {
    return (
      <div className="jsonl-empty">
        {loading ? $t("jsonl.searchingShort") : $t("jsonl.noMatches")}
      </div>
    );
  }

  const select = (next: number) => {
    if (next < 0 || next >= rows.length) return;
    onSelect(rows[next]);
    ref.current?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (rows.length === 0) return;
    const page = Math.max(1, Math.floor((ref.current?.clientHeight ?? 0) / JSON_ROW_HEIGHT) - 1);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      select(Math.min(rows.length - 1, Math.max(0, selectedIndex) + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      select(Math.max(0, (selectedIndex < 0 ? rows.length : selectedIndex) - 1));
    } else if (event.key === "PageDown") {
      event.preventDefault();
      select(Math.min(rows.length - 1, Math.max(0, selectedIndex) + page));
    } else if (event.key === "PageUp") {
      event.preventDefault();
      select(Math.max(0, (selectedIndex < 0 ? rows.length : selectedIndex) - page));
    } else if (event.key === "Home") {
      event.preventDefault();
      select(0);
    } else if (event.key === "End") {
      event.preventDefault();
      select(rows.length - 1);
    }
  };

  const rendered = [];
  for (let index = start; index < end; index++) {
    const row = rows[index];
    const active = row.key === selectedKey;
    rendered.push(
      <div
        key={row.key}
        id={`json-search-${index}`}
        role="option"
        aria-selected={active}
        aria-posinset={index + 1}
        aria-setsize={rows.length}
        className={`json-search-row${active ? " json-search-row--selected" : ""}`}
        style={{
          position: "absolute",
          top: index * JSON_ROW_HEIGHT,
          left: 0,
          right: 0,
          height: JSON_ROW_HEIGHT,
        }}
        onClick={() => onSelect(row)}
      >
        <span
          className={`json-search-row__lead${
            row.index === undefined ? " json-search-row__lead--path" : ""
          }`}
        >
          {row.index === undefined ? row.path : `[${row.index}]`}
        </span>
        <span className="json-search-row__snippet">{marked(row.snippet, query)}</span>
        {row.count !== undefined && <span className="json-search-row__count">{row.count}</span>}
      </div>,
    );
  }

  return (
    <div
      ref={ref}
      className="json-search-list"
      role="listbox"
      tabIndex={0}
      aria-label={$t("json.results")}
      aria-activedescendant={selectedIndex >= 0 ? `json-search-${selectedIndex}` : undefined}
      onScroll={onScroll}
      onKeyDown={onKeyDown}
    >
      <div style={{ height: totalHeight, position: "relative" }}>{rendered}</div>
    </div>
  );
}
