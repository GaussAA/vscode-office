/**
 * A `WorkbookSheetSource` whose rows live in the host cache (ADR-0027).
 *
 * The metadata (sheet names, row/column counts) arrives once; `readRows` asks the host for the
 * window the viewport needs. `selectSheet` reuses the same metadata and loader, so switching
 * sheets does not parse or re-fetch the workbook.
 */
import type { ExcelWorkbookSheetMeta } from "@/common/excelWorkbook";
import type { WorkbookSheetSource } from "./workbookSource";

export interface HostWorkbookMeta {
  key: string;
  sheets: ExcelWorkbookSheetMeta[];
}

export type HostWorkbookRowsLoader = (
  key: string,
  sheetIndex: number,
  start: number,
  end: number,
) => Promise<string[][]>;

export function createHostWorkbookSource(
  meta: HostWorkbookMeta,
  loadRows: HostWorkbookRowsLoader,
  sheetIndex = 0,
): WorkbookSheetSource {
  const safeIndex = Math.max(0, Math.min(sheetIndex, Math.max(0, meta.sheets.length - 1)));
  const sheet = meta.sheets[safeIndex];
  const rowCount = Math.max(0, sheet?.rowCount ?? 0);
  return {
    kind: "workbook",
    sheetNames: meta.sheets.map((entry) => entry.name),
    sheetIndex: safeIndex,
    rowCount,
    columnCount: Math.max(1, sheet?.columnCount ?? 1),
    async readRows(start: number, end: number): Promise<string[][]> {
      const from = Math.max(0, Math.min(start, rowCount));
      const to = Math.max(from, Math.min(end, rowCount));
      if (to <= from) return [];
      return loadRows(meta.key, safeIndex, from, to);
    },
    selectSheet(index: number): WorkbookSheetSource {
      return createHostWorkbookSource(meta, loadRows, index);
    },
  };
}
