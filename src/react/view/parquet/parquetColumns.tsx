import type { ColumnsType } from "antd/es/table";
import { DATA_COLUMN_WIDTH, INDEX_COLUMN_WIDTH } from "./parquetLayout";
import type { ParquetColumnLayout } from "./parquetColumnLayout";
import { ParquetCell, type TableRow } from "./parquetCell";
import type { ParquetFileInfo } from "./parquetParser";

export interface ParquetColumnsOptions {
  fileInfo: ParquetFileInfo | null;
  loadedStart: number;
  query: string;
  activeColumn: number | null;
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
  fileInfo.columns.forEach((column, position) => {
    const active = activeColumn === position;
    columns.push({
      title: column.name,
      dataIndex: column.name,
      key: column.name,
      ellipsis: true,
      width: columnLayout.widths[position] ?? DATA_COLUMN_WIDTH,
      align: column.category === "numeric" ? "right" : "left",
      className: active ? "parquet-viewer__column--active" : undefined,
      // A grid whose header and body are separate scroll surfaces has to state the column
      // ordinal on both sides: assistive tech maps a cell to its header by `aria-colindex`,
      // and the header itself needs the matching number.
      onHeaderCell: () => ({
        role: "columnheader",
        "aria-colindex": position + 2,
        columnKey: column.name,
        onResizeColumn: (width: number) => onResizeColumn(column.name, width),
        onResetColumn: () => onResetColumn(column.name),
      }),
      onCell: () => ({ role: "gridcell", "aria-colindex": position + 2 }),
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
