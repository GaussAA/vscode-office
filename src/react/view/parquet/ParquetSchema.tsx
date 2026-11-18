import { useMemo, useState } from "react";
import type { ParquetEmptyShare, ParquetProfile } from "@/common/parquetProfileTypes";
import { $t } from "../../i18n/i18nConfig.ts";
import { COLUMN_ICONS } from "./parquetCell";
import { formatShare } from "./formatShare";
import type { ParquetColumnInfo } from "@/common/parquetReader";

interface ParquetSchemaProps {
  columns: ParquetColumnInfo[];
  activeColumn: number | null;
  siderWidth: number;
  /** Null while the host has not answered; every row then simply has no badge. */
  profile?: ParquetProfile | null;
  /** Per-column empty-share answers, keyed by name; a scanned structured column can show a number. */
  shares: ReadonlyMap<string, ParquetEmptyShare>;
  /** The rail-level batch scan's state; its action is rendered only when it has work to do. */
  structuredScan: { loading: boolean; scanned: number; total: number; error: string | null };
  onScanStructured: () => void;
  onFocusColumn: (position: number) => void;
  /** Open the profile panel for this column (mouse on the badge, or `i` on the focused row). */
  onInspectColumn: (column: ParquetColumnInfo) => void;
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
  shares,
  structuredScan,
  onScanStructured,
  onFocusColumn,
  onInspectColumn,
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

  // The batch action is about the structured columns that have no value-level answer yet.
  // A silent host shows neither the button nor a badge: no answer, no action.
  const unscannedStructured = useMemo(
    () => columns.filter((column) => column.nested && !shares.has(column.name)),
    [columns, shares],
  );
  const structuredPercent =
    structuredScan.total > 0
      ? Math.round((structuredScan.scanned / structuredScan.total) * 100)
      : 0;
  const showStructuredScan =
    !!profile && (unscannedStructured.length > 0 || structuredScan.loading);

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
      {showStructuredScan && (
        <button
          type="button"
          className="parquet-viewer__sider-scan"
          onClick={onScanStructured}
          disabled={structuredScan.loading}
          title={$t("parquet.scanStructured")}
        >
          <span className="codicon codicon-checklist" />
          {structuredScan.loading
            ? $t("parquet.scanningStructured", { percent: String(structuredPercent) })
            : $t("parquet.scanStructured")}
        </button>
      )}
      {structuredScan.error && (
        <p className="parquet-viewer__sider-scan-error" role="alert">
          {structuredScan.error}
        </p>
      )}
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
          const target = visibleColumns[fieldCursor];
          const move = keys[event.key];
          if (move === undefined) {
            // `i` inspects the focused field; the row's own activation is still the jump.
            if ((event.key === "i" || event.key === "I") && target) {
              event.preventDefault();
              onInspectColumn(target.column);
            }
            return;
          }
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
          const moved = visibleColumns[next];
          if (moved) {
            onFocusColumn(moved.position);
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
          const share = shares.get(column.name);
          // The badge is visual only; the row's accessible name carries the same sentence, so
          // a screen reader hears "Jump to column name — 12% of rows are null" rather than a
          // bare percentage the surrounding UI cannot explain.
          let badge: string | null = null;
          let summary: string | null = null;
          if (share && share.scanned > 0) {
            // A scan is value-level, so it is the only source that can count empty lists and
            // empty strings; `empty` in the badge keeps it distinct from the metadata `null`.
            const formatted = formatShare("empty", share.emptyRatio, !share.complete);
            badge = formatted.badge;
            summary = $t("parquet.emptyShare", { percent: formatted.percent });
            if (!share.complete) {
              summary += ` · ${$t("parquet.profileScanned", {
                scanned: share.scanned.toLocaleString(),
                total: share.rowCount.toLocaleString(),
              })}`;
            }
          } else if (stats?.state === "available" && stats.nullRatio !== undefined) {
            const share = formatShare("null", stats.nullRatio);
            badge = share.badge;
            summary = $t("parquet.nullShare", { percent: share.percent });
          } else if (stats?.state === "partial") {
            badge = "—";
            summary = $t("parquet.partialStatistics");
          } else if (stats?.state === "missing") {
            badge = "—";
            summary = $t("parquet.noStatistics");
          } else if (stats?.state === "nested") {
            // Leaf statistics are not row values, so there is no metadata number. This is the
            // mouse path to the scan; `i` on the focused row is the keyboard path.
            badge = "null ?";
            summary = $t("parquet.nestedScanHint");
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
              data-column={column.name}
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
                <span
                  className="parquet-viewer__list-null"
                  aria-hidden="true"
                  title={summary ?? undefined}
                  onClick={(event) => {
                    // Mouse convenience only: an interactive element inside the row button
                    // would be invalid HTML, so the keyboard path is `i` on the focused row.
                    event.stopPropagation();
                    onInspectColumn(column);
                  }}
                >
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
