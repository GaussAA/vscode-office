import { useMemo, useState } from "react";
import { $t } from "../../i18n/i18nConfig.ts";
import { COLUMN_ICONS } from "./parquetCell";
import type { ParquetColumnInfo } from "./parquetParser";

interface ParquetSchemaProps {
  columns: ParquetColumnInfo[];
  activeColumn: number | null;
  siderWidth: number;
  onFocusColumn: (position: number) => void;
}

/**
 * Schema list with its own filter and single-tab-stop cursor. Keeping this state here means the
 * viewer only has to know which field is active and how to bring it into view.
 */
export default function ParquetSchema({
  columns,
  activeColumn,
  siderWidth,
  onFocusColumn,
}: ParquetSchemaProps) {
  const [fieldFilter, setFieldFilter] = useState("");
  const [fieldCursor, setFieldCursor] = useState(0);

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
          return (
            <button
              key={column.name}
              type="button"
              role="option"
              className={`parquet-viewer__list-item${active ? " parquet-viewer__list-item--active" : ""}`}
              aria-selected={active}
              aria-label={$t("parquet.jumpToColumn", { name: column.name })}
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
