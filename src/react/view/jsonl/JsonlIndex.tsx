import { Tree } from "antd";
import type { DataNode } from "antd/es/tree";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { JsonlEntrySummary } from "../../../common/jsonlTypes.ts";
import { ROW_HEIGHT, formatBytes } from "../entry/entryFormat.ts";
import { highlightRuns } from "../../common/highlight.ts";
import { $t } from "../../i18n/i18nConfig.ts";

interface Props {
  /** Ordered rows: a contiguous window in directory mode, the matches in search mode. */
  items: JsonlEntrySummary[];
  selected: number;
  /** True while a chunk (or a search) is in flight. */
  loading: boolean;
  onSelect: (index: number) => void;
  /** Undefined in search mode — there is nothing more to load. */
  onNeedMore?: () => void;
  emptyText?: string;
  /** Active search term, used to highlight matches in each row. */
  highlight?: string;
  /** True when `items` ends before the file does: renders a row and auto-fills short panes. */
  hasMore?: boolean;
  /** Start of the current directory window; a replace (jump) resets the auto-fill budget. */
  windowStart?: number;
}

const PAGE_STEP = 10;
/**
 * How many chunks a short window may pull in before the "Load more" row takes over. A byte
 * budget can return one or two rows, and a window that does not overflow the pane emits no
 * scroll event — the directory would be stuck permanently without this.
 */
const AUTO_FILL_ROUNDS = 4;

/** Left pane: the directory of entries. One line = one row, never nested. */
export default function JsonlIndex({
  items,
  selected,
  loading,
  onSelect,
  onNeedMore,
  emptyText,
  highlight,
  hasMore = false,
  windowStart = 0,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [height, setHeight] = useState(320);
  const autoFilled = useRef(0);

  const holder = useCallback((): HTMLElement | null => {
    return containerRef.current?.querySelector<HTMLElement>(".ant-tree-list-holder") ?? null;
  }, []);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setHeight(Math.max(120, element.clientHeight)));
    observer.observe(element);
    setHeight(Math.max(120, element.clientHeight));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    autoFilled.current = 0;
  }, [windowStart]);

  // A reload empties the window before the next one arrives; the start can stay 0, so the
  // windowStart reset alone would keep an exhausted auto-fill budget.
  useEffect(() => {
    if (items.length === 0) autoFilled.current = 0;
  }, [items.length]);

  // A window that fits entirely in the pane never scrolls, so the scroll listener below can
  // never fire. Pull a bounded number of chunks until it overflows; the Load more row covers
  // the rest (a single 8 MB line still cannot fill a 754px pane on its own).
  useEffect(() => {
    if (!onNeedMore || !hasMore || loading || items.length === 0) return;
    const frame = requestAnimationFrame(() => {
      const element = holder();
      const pane = containerRef.current;
      if (!element || !pane) return;
      // The holder is content-sized up to `max-height`, so `clientHeight` is not the pane
      // height: two rows and the load-more row already make scrollHeight 3px larger than
      // clientHeight. Compare against the pane instead, or a short window looks scrollable
      // and the auto-fill never runs.
      if (element.scrollHeight >= pane.clientHeight) return;
      if (autoFilled.current >= AUTO_FILL_ROUNDS) return;
      autoFilled.current += 1;
      onNeedMore();
    });
    return () => cancelAnimationFrame(frame);
  }, [holder, loading, onNeedMore, hasMore, items.length, windowStart]);

  useEffect(() => {
    const element = holder();
    if (!element || !onNeedMore) return;
    const onScroll = () => {
      const remaining = element.scrollHeight - element.scrollTop - element.clientHeight;
      if (remaining < 400 && !loading) onNeedMore();
    };
    element.addEventListener("scroll", onScroll, { passive: true });
    return () => element.removeEventListener("scroll", onScroll);
  }, [holder, loading, onNeedMore]);

  const positionOf = useMemo(() => {
    const map = new Map<number, number>();
    items.forEach((entry, position) => map.set(entry.index, position));
    return map;
  }, [items]);

  // keep the selected entry visible
  useEffect(() => {
    const element = holder();
    const position = positionOf.get(selected);
    if (!element || position === undefined) return;
    const top = position * ROW_HEIGHT;
    const viewTop = element.scrollTop;
    const viewBottom = viewTop + element.clientHeight;
    if (top < viewTop || top + ROW_HEIGHT > viewBottom) {
      element.scrollTop = Math.max(0, top - element.clientHeight / 2);
    }
  }, [holder, selected, positionOf]);

  const renderText = useCallback(
    (entry: JsonlEntrySummary) => {
      const text = entry.snippet ?? entry.raw;
      return highlightRuns(text, highlight).map((part, position) =>
        part.hit ? (
          <mark key={position} className="jsonl-hit">
            {part.text}
          </mark>
        ) : (
          <span key={position}>{part.text}</span>
        ),
      );
    },
    [highlight],
  );
  const treeData = useMemo<DataNode[]>(() => {
    const rows: DataNode[] = items.map((entry) => {
      const index = entry.index;
      let title: ReactNode;
      if (entry.kind === "empty") {
        title = (
          <span className="jsonl-entry">
            <span className="jsonl-lineno">{index + 1}</span>
            <span className="jsonl-type">{$t("jsonl.chipEmpty")}</span>
          </span>
        );
      } else if (entry.kind === "invalid") {
        title = (
          <span className="jsonl-entry">
            <span className="jsonl-lineno">{index + 1}</span>
            <span className="jsonl-chip jsonl-chip--error">{$t("jsonl.chipInvalid")}</span>
            <span className="jsonl-entry__raw jsonl-entry__raw--error">{renderText(entry)}</span>
          </span>
        );
      } else if (entry.kind === "too-large") {
        title = (
          <span className="jsonl-entry">
            <span className="jsonl-lineno">{index + 1}</span>
            <span className="jsonl-chip jsonl-chip--warn">{$t("jsonl.chipTooLarge")}</span>
            <span className="jsonl-muted">{formatBytes(entry.size)}</span>
          </span>
        );
      } else {
        title = (
          <span className="jsonl-entry">
            <span className="jsonl-lineno">{index + 1}</span>
            {entry.kind === "value" && entry.label !== undefined && (
              <span className="jsonl-entry__label">{entry.label}</span>
            )}
            {entry.hit !== undefined && (
              // Structure, not prose: `key`/`value` name JSON parts the way `LIST` and `STRUCT`
              // do, so they stay untranslated. That is also why this needs no message key and
              // does not touch the translation budget of the seven fallback locales.
              <span className={`jsonl-chip jsonl-chip--hit jsonl-chip--hit-${entry.hit}`}>
                {entry.hit === "key" ? "key" : entry.hit === "value" ? "value" : "key+value"}
              </span>
            )}
            <span className="jsonl-entry__raw">{renderText(entry)}</span>
          </span>
        );
      }
      return { key: String(index), title, isLeaf: true };
    });
    if (hasMore && onNeedMore) {
      rows.push({
        key: "__load_more__",
        isLeaf: true,
        selectable: false,
        title: (
          <span className="jsonl-entry">
            <button
              type="button"
              className="jsonl-load-more"
              disabled={loading}
              onClick={(event) => {
                event.stopPropagation();
                onNeedMore();
              }}
            >
              {loading ? $t("jsonl.loading") : $t("jsonl.loadMore")}
            </button>
          </span>
        ),
      });
    }
    return rows;
  }, [items, renderText, hasMore, loading, onNeedMore]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      const position = positionOf.get(selected) ?? 0;
      let nextPosition: number | null = null;
      switch (event.key) {
        case "ArrowDown":
          nextPosition = position + 1;
          break;
        case "ArrowUp":
          nextPosition = position - 1;
          break;
        case "PageDown":
          nextPosition = position + PAGE_STEP;
          break;
        case "PageUp":
          nextPosition = position - PAGE_STEP;
          break;
        case "Home":
          nextPosition = 0;
          break;
        case "End":
          nextPosition = items.length - 1;
          break;
        default:
          return;
      }
      event.preventDefault();
      event.stopPropagation();
      const clamped = Math.max(0, Math.min(items.length - 1, nextPosition));
      const next = items[clamped];
      if (next && next.index !== selected) onSelect(next.index);
    },
    [items, positionOf, selected, onSelect],
  );

  return (
    <div
      className="jsonl-index"
      ref={containerRef}
      tabIndex={0}
      data-loaded={items.length}
      onKeyDown={onKeyDown}
    >
      {items.length === 0 ? (
        <div className="jsonl-empty">{emptyText ?? $t("jsonl.empty")}</div>
      ) : (
        <Tree
          className="jsonl-index__tree"
          treeData={treeData}
          selectedKeys={[String(selected)]}
          onSelect={(keys) => {
            const key = keys[0];
            if (key !== undefined) onSelect(Number(key));
          }}
          height={height}
          itemHeight={ROW_HEIGHT}
          virtual
          showIcon={false}
        />
      )}
    </div>
  );
}
