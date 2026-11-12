import { useMemo, useState } from "react";
import type { ParquetProfile } from "@/common/parquetProfileTypes";
import { $t } from "../../i18n/i18nConfig.ts";
import { COLUMN_ICONS } from "./parquetCell";
import type { ParquetColumnInfo } from "./parquetParser";

interface ParquetSchemaProps {
  columns: ParquetColumnInfo[];
  activeColumn: number | null;
  siderWidth: number;
  /** Null while the host has not answered; every row then simply has no badge. */
  profile?: ParquetProfile | null;
  onFocusColumn: (position: number) => void;
}

/**
 * `0.4%` must not render as `0%`: the number is the answer, so it rounds only when the
 * difference stays visible.
 */
function formatNullShare(ratio: number): { badge: string; percent: string } {
  if (ratio <= 0) return { badge: "null 0%", percent: "0" };
  if (ratio < 0.01) return { badge: "null <1%", percent: "<1" };
  const percent = String(Math.round(ratio * 100));
  return { badge: `null ${percent}%`, percent };
}

/**
 * Schema list with its own filter and single-tab-stop cursor. Keeping this state here means the
 * viewer only has to know which field is active and how to bring it into view.
 */
export default function ParquetSchema({
  columns,
  activeColumn,
  siderWidth,
  profile,
  onFocusColumn,
}: ParquetSchemaProps) {
  const [fieldFilter, setFieldFilter] = useState("");
  const [fieldCursor, setFieldCursor] = useState(0);

  // Keyed by column name: the profile carries names, not positions, because a nested schema
  // collapses to one name per top-level column.
  const statsByName = useMemo(
    () => new Map((profile?.columns ?? []).map((column) => [column.name, column])),
    [profile],
  );

  const visibleColumns = useMemo(() => {
    const all = columns.map((column, position) => ({ column, position }));
    const needle = fieldFilter.trim().toLowerCase();
    if (!needle) return all;
    return all.filter(({ column }) => column.name.toLowerCase().includes(needle));
  }, [columns, fieldFilter]);

  const resetCursor = () => setFieldCursor(0);

  return (
    <aside className="parquet-viewer__sider" style={{ width: siderWidth }}>
      <div className="parquet-viewer__sider-heading">
        <span className="parquet-viewer__sider-title">
          <span className="codicon codicon-symbol-structure parquet-icon parquet-icon--schema" />
          {$t("parquet.schema")}
        </span>
        <span className="parquet-viewer__sider-count">
          {visibleColumns.length === columns.length
            ? columns.length
            : `${visibleColumns.length}/${columns.length}`}
        </span>
      </div>
      <div className="parquet-viewer__field-filter-row">
        <input
          type="text"
          className="parquet-viewer__field-filter"
          value={fieldFilter}
          placeholder={$t("parquet.filterFields")}
          aria-label={$t("parquet.filterFields")}
          spellCheck={false}
          onChange={(event) => {
            setFieldFilter(event.target.value);
            resetCursor();
          }}
        />
        {fieldFilter !== "" && (
          <button
            type="button"
            className="parquet-viewer__field-filter-clear"
            onClick={() => {
              setFieldFilter("");
              resetCursor();
            }}
            title={$t("common.close")}
            aria-label={$t("common.close")}
          >
            <span className="codicon codicon-close" />
          </button>
        )}
      </div>
      <div
        className="parquet-viewer__list"
        role="listbox"
        aria-label={$t("parquet.schema")}
        onKeyDown={(event) => {
          // One tab stop for the whole list: 60 fields used to sit between the search box and
          // the grid, so reaching the table meant 60 presses of Tab.
          const keys: Record<string, number> = {
            ArrowDown: 1,
            ArrowUp: -1,
            Home: -Infinity,
            End: Infinity,
          };
          const move = keys[event.key];
          if (move === undefined) return;
          event.preventDefault();
          const last = Math.max(0, visibleColumns.length - 1);
          const next = Math.max(
            0,
            Math.min(
              last,
              fieldCursor + (move === -Infinity ? -last : move === Infinity ? last : move),
            ),
          );
          setFieldCursor(next);
          const target = visibleColumns[next];
          if (target) {
            onFocusColumn(target.position);
            const item = event.currentTarget.querySelectorAll<HTMLElement>(
              ".parquet-viewer__list-item",
            )[next];
            item?.focus();
          }
        }}
      >
        {visibleColumns.map(({ column, position }, index) => {
          const icon = COLUMN_ICONS[column.category];
          const kind = column.category;
          const active = activeColumn === position;
          const stats = statsByName.get(column.name);
          // The badge is visual only; the row's accessible name carries the same sentence, so
          // a screen reader hears "Jump to column name — 12% of rows are null" rather than a
          // bare percentage the surrounding UI cannot explain.
          let badge: string | null = null;
          let summary: string | null = null;
          if (stats?.state === "available" && stats.nullRatio !== undefined) {
            const share = formatNullShare(stats.nullRatio);
            badge = share.badge;
            summary = $t("parquet.nullShare", { percent: share.percent });
          } else if (stats?.state === "partial") {
            badge = "—";
            summary = $t("parquet.partialStatistics");
          } else if (stats?.state === "missing") {
            badge = "—";
            summary = $t("parquet.noStatistics");
          }
          const label = $t("parquet.jumpToColumn", { name: column.name });
          return (
            <button
              key={column.name}
              type="button"
              role="option"
              className={`parquet-viewer__list-item${active ? " parquet-viewer__list-item--active" : ""}`}
              aria-selected={active}
              aria-label={summary ? `${label} — ${summary}` : label}
              title={`${column.name} · ${column.type}`}
              tabIndex={index === fieldCursor ? 0 : -1}
              onFocus={() => setFieldCursor(index)}
              onClick={() => onFocusColumn(position)}
            >
              <span
                className={`codicon parquet-viewer__list-icon parquet-viewer__list-icon--${kind} ${icon}`}
              />
              <span className="parquet-viewer__list-name" title={column.name}>
                {column.name}
              </span>
              {badge && (
                <span className="parquet-viewer__list-null" aria-hidden="true">
                  {badge}
                </span>
              )}
              <span className="parquet-viewer__list-type" title={column.type}>
                {column.type}
              </span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
