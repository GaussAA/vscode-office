/**
 * A workbook as a `SheetSource` (phase 4 of ADR-0017).
 *
 * Workbooks cannot be streamed: a zip's deflate stream is not seekable, so the sheet is parsed
 * whole. What the windowed view buys is the *representation* — arrays of strings instead of one
 * object per cell — and rendering only the viewport. This module wraps the parsed rows and
 * exposes the same `readRows` contract the CSV source uses.
 */
import type { SheetSource } from "./sheetSource";
import type { WorkbookSheetRows } from "./workbookRows";

export interface WorkbookSheetSource extends SheetSource {
  readonly kind: "workbook";
  readonly sheetNames: string[];
  /** Index of the sheet this source serves. */
  readonly sheetIndex: number;
  /** A source for another sheet; the parsed rows are shared, nothing is re-read. */
  selectSheet(index: number): WorkbookSheetSource;
}

export function createWorkbookSheetSource(
  sheets: WorkbookSheetRows[],
  sheetIndex = 0,
): WorkbookSheetSource {
  const safeIndex = Math.max(0, Math.min(sheetIndex, Math.max(0, sheets.length - 1)));
  const sheet = sheets[safeIndex];
  const rows = sheet?.rows ?? [];
  const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 1);

  return {
    kind: "workbook",
    sheetNames: sheets.map((entry) => entry.name),
    sheetIndex: safeIndex,
    rowCount: rows.length,
    columnCount: Math.max(1, columnCount),
    async readRows(start: number, end: number): Promise<string[][]> {
      const from = Math.max(0, Math.min(start, rows.length));
      const to = Math.max(from, Math.min(end, rows.length));
      return rows.slice(from, to);
    },
    selectSheet(index: number): WorkbookSheetSource {
      return createWorkbookSheetSource(sheets, index);
    },
  };
}
