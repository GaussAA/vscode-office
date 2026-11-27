import type { ColumnsType } from "antd/es/table";
import { $t } from "../../i18n/i18nConfig.ts";
import { DATA_COLUMN_WIDTH, INDEX_COLUMN_WIDTH } from "./parquetLayout";
import type { ParquetColumnLayout } from "./parquetColumnLayout";
import { ParquetCell, type TableRow } from "./parquetCell";
import type { ParquetFileInfo } from "@/common/parquetReader";

export interface ParquetColumnsOptions {
  fileInfo: ParquetFileInfo | null;
  loadedStart: number;
  query: string;
  activeColumn: number | null;
  /** Columns with at least one hit in the current search; tinted while the search stands. */
  matchedColumns: ReadonlySet<number>;
  /** The schema-pinned column and the edge it sticks to, if it has left the viewport. */
  pinnedColumn: number | null;
  pinSide: "start" | "end" | null;
  /** Absolute positions rendered, in table order; hidden columns are simply absent. */
  visibleColumns: number[];
  columnLayout: ParquetColumnLayout;
  onSelectCell: (cell: { row: number; col: number }) => void;
  onActivateColumn: (position: number) => void;
  onInspect: (selection: { row: number; column: string; value: unknown }) => void;
  onResizeColumn: (name: string, width: number) => void;
  onResetColumn: (name: string) => void;
}

/**
 * The antd column contract for the parquet grid: ordinal ARIA on both the header and body,
 * stable keys, resize handlers and the filler that owns leftover width. Keeping this out of the
 * viewer makes the grid's accessibility model inspectable without a browser.
 */
export function buildParquetColumns({
  fileInfo,
  loadedStart,
  query,
  activeColumn,
  matchedColumns,
  pinnedColumn,
  pinSide,
  visibleColumns,
  columnLayout,
  onSelectCell,
  onActivateColumn,
  onInspect,
  onResizeColumn,
  onResetColumn,
}: ParquetColumnsOptions): ColumnsType<TableRow> {
  if (!fileInfo) return [];
  const columns: ColumnsType<TableRow> = [
    {
      title: "#",
      key: "__index",
      width: INDEX_COLUMN_WIDTH,
      // Numbers line up on their right edge everywhere in this surface, the row index
      // included: centring one of them made the column read as a label.
      align: "right",
      fixed: "left",
      className: "parquet-viewer__index-cell",
      onCell: () => ({ role: "rowheader", "aria-colindex": 1 }),
      onHeaderCell: () => ({ role: "columnheader", "aria-colindex": 1 }),
      render: (_value, _row, index) => loadedStart + index + 1,
    },
  ];
  visibleColumns.forEach((position, order) => {
    const column = fileInfo.columns[position];
    if (!column) return;
    const active = activeColumn === position;
    const hit = matchedColumns.has(position);
    const pinned = pinnedColumn === position && pinSide !== null;
    const classes = [
      active ? "parquet-viewer__column--active" : "",
      hit ? "parquet-viewer__column--hit" : "",
      pinned ? "parquet-viewer__column--pinned" : "",
    ]
      .filter(Boolean)
      .join(" ");
    columns.push({
      title: (
        <span className="parquet-viewer__column-title">
          {hit ? (
            <span className="parquet-viewer__hit-title">
              {column.name}
              <span className="parquet-viewer__hit-dot" aria-hidden="true" />
            </span>
          ) : (
            column.name
          )}
          {pinned && (
            <span
              className="codicon codicon-pin parquet-viewer__pin-indicator"
              title={$t("parquet.pinnedColumn")}
              aria-label={$t("parquet.pinnedColumn")}
            />
          )}
        </span>
      ),
      dataIndex: column.name,
      key: column.name,
      ellipsis: true,
      width: columnLayout.widths[position] ?? DATA_COLUMN_WIDTH,
      align: column.category === "numeric" ? "right" : "left",
      fixed: pinned ? pinSide : undefined,
      className: classes || undefined,
      // A grid whose header and body are separate scroll surfaces has to state the column
      // ordinal on both sides: assistive tech maps a cell to its header by `aria-colindex`,
      // and the header itself needs the matching number.
      onHeaderCell: () => ({
        role: "columnheader",
        "aria-colindex": order + 2,
        "data-col-position": position,
        title: column.name,
        columnKey: column.name,
        onResizeColumn: (width: number) => onResizeColumn(column.name, width),
        onResetColumn: () => onResetColumn(column.name),
      }),
      onCell: () => ({
        role: "gridcell",
        "aria-colindex": order + 2,
        "data-col-position": position,
      }),
      render: (value: unknown, _row, index) => {
        const rowIndex = loadedStart + index;
        return (
          <ParquetCell
            value={value}
            rowIndex={rowIndex}
            pageIndex={index}
            position={position}
            column={column}
            query={query}
            onActivate={() => {
              onSelectCell({ row: index, col: position });
              onActivateColumn(position);
              onInspect({ row: rowIndex, column: column.name, value });
            }}
          />
        );
      },
    });
  });
  // A column with no data: it exists so the capped layout can own the leftover width instead
  // of having rc-table spread it over the real columns. Hidden from assistive tech, since it
  // is not a column of the file.
  if (columnLayout.filler > 0) {
    columns.push({
      title: "",
      key: "__filler",
      width: columnLayout.filler,
      className: "parquet-viewer__filler-cell",
      onHeaderCell: () => ({ "aria-hidden": true, role: "presentation" }),
      onCell: () => ({ "aria-hidden": true, role: "presentation" }),
      render: () => null,
    });
  }
  return columns;
}
