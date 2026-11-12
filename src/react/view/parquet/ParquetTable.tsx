import type { KeyboardEventHandler, RefObject } from "react";
import { Table } from "antd";
import type { ColumnsType, TableRef } from "antd/es/table";
import { $t } from "../../i18n/i18nConfig.ts";
import { CursorContext, type CellCursor, type TableRow } from "./parquetCell.tsx";
import type { ParquetColumnLayout } from "./parquetColumnLayout.ts";
import { PresentationTable, ResizableHeaderCell } from "./parquetHeaders.tsx";
import type { ParquetFileInfo } from "./parquetParser.ts";

interface ParquetTableProps {
  tableRef: RefObject<TableRef | null>;
  tableWrapRef: RefObject<HTMLDivElement | null>;
  fileName: string;
  fileInfo: ParquetFileInfo;
  cursor: CellCursor | null;
  pageSize: number;
  loadedStart: number;
  tableBodyHeight: number;
  tableRows: TableRow[];
  tableColumns: ColumnsType<TableRow>;
  matchRows: Set<number>;
  targetRow: number | null;
  columnLayout: ParquetColumnLayout;
  onKeyDown: KeyboardEventHandler<HTMLDivElement>;
}

/**
 * The grid surface: the virtual table, its ARIA row/column model, alternating/hit/target row
 * classes and the empty-file state. ParquetViewer owns loading and page navigation.
 */
export default function ParquetTable({
  tableRef,
  tableWrapRef,
  fileName,
  fileInfo,
  cursor,
  pageSize,
  loadedStart,
  tableBodyHeight,
  tableRows,
  tableColumns,
  matchRows,
  targetRow,
  columnLayout,
  onKeyDown,
}: ParquetTableProps) {
  return (
    <main className="parquet-viewer__main">
      {fileInfo.rowCount === 0 ? (
        <div className="parquet-viewer__no-rows">
          <span className="codicon codicon-table" />
          <span>{$t("parquet.noRows")}</span>
        </div>
      ) : (
        <div
          className="parquet-viewer__table-wrap"
          ref={tableWrapRef}
          tabIndex={cursor ? -1 : 0}
          onKeyDown={onKeyDown}
          // A grid, because the keyboard model is one: roving tabindex, arrow keys,
          // Enter to inspect. The counts are the file's, not the DOM's — only a window
          // of rows is rendered, which is exactly what these two attributes are for.
          role="grid"
          aria-label={fileName || undefined}
          aria-rowcount={fileInfo.rowCount}
          aria-colcount={fileInfo.columns.length + 1}
          // A page is one screenful, so its size is a runtime fact. Exposed for the UI
          // assertions (and it documents the model in the DOM).
          data-page-size={pageSize}
          data-page-start={loadedStart}
        >
          <CursorContext.Provider value={cursor}>
            <Table<TableRow>
              ref={tableRef}
              virtual
              className="parquet-table"
              dataSource={tableRows}
              columns={tableColumns}
              // The empty state is rendered above instead of the table; a second copy
              // here would only exist to be found in a screenshot.
              locale={{ emptyText: "" }}
              pagination={false}
              size="small"
              scroll={{
                // Virtual scrolling needs numbers: x is the full column extent (or the
                // viewport when it is wider), y is the body height measured above.
                // The layout already accounts for the viewport; stretching past it is
                // what blew narrow files up.
                x: columnLayout.extent + columnLayout.filler,
                y: tableBodyHeight,
              }}
              rowClassName={(_row, index) => {
                const absolute = loadedStart + index;
                const classes: string[] = [];
                if (index % 2 === 1) classes.push("parquet-viewer__row--alt");
                if (matchRows.has(absolute)) classes.push("parquet-viewer__row--match");
                if (targetRow === absolute) classes.push("parquet-viewer__row--target");
                return classes.join(" ");
              }}
              // The virtual body renders divs, so the row's grid role has to come from
              // the same prop that carries the class. `aria-rowindex` is the absolute
              // row, not the index within the rendered window.
              onRow={(_row, index) => ({
                role: "row",
                "aria-rowindex": loadedStart + (index ?? 0) + 1,
              })}
              components={{
                table: PresentationTable,
                header: { table: PresentationTable, cell: ResizableHeaderCell },
              }}
            />
          </CursorContext.Provider>
        </div>
      )}
    </main>
  );
}
