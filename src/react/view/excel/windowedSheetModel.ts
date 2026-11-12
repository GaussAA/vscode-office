import type { SheetSource } from "./sheetSource";

/** Geometry and coordinate rules shared by the windowed sheet and its tests. */
export const ROW_HEIGHT = 22;
export const HEADER_HEIGHT = 38;
export const INDEX_WIDTH = 56;
export const MIN_COLUMN_WIDTH = 140;
export const MAX_COLUMN_WIDTH = 420;
export const OVERSCAN = 4;
export const COPY_FEEDBACK_MS = 1_200;

/** Body source: the file source without its first (frozen header) row. */
export function toBodySource(source: SheetSource): SheetSource {
  return {
    ...source,
    rowCount: Math.max(0, source.rowCount - 1),
    readRows: (start, end) => source.readRows(start + 1, end + 1),
  };
}

export function clampColumnWidth(width: number): number {
  return Math.max(MIN_COLUMN_WIDTH, Math.min(MAX_COLUMN_WIDTH, Math.round(width)));
}

export function gridTemplateFor(
  columnWidths: Readonly<Record<number, number>>,
  columnCount: number,
): string {
  const columns: string[] = [];
  for (let column = 0; column < columnCount; column++) {
    const width = columnWidths[column];
    columns.push(width ? `${width}px` : `minmax(${MIN_COLUMN_WIDTH}px, 1fr)`);
  }
  return `${INDEX_WIDTH}px ${columns.join(" ")}`;
}

/** The file is 1-based and row 1 is the frozen header; the body is 0-based. */
export function fileRowToBodyRow(fileRow: number, fileRowCount: number): number {
  if (fileRowCount <= 1) return 0;
  return Math.max(0, Math.min(fileRow - 2, fileRowCount - 2));
}

/** The grid displays file coordinates, so body row 0 is file row 2. */
export function bodyRowToFileRow(bodyRow: number): number {
  return bodyRow + 2;
}

export function cellId(row: number, column: number): string {
  return `windowed-sheet-cell-${row}-${column}`;
}

/** Spreadsheet column labels: A..Z, AA.. (the grid view shows the same, so the two agree). */
export function columnName(index: number): string {
  let name = "";
  let remaining = index;
  do {
    name = String.fromCharCode(65 + (remaining % 26)) + name;
    remaining = Math.floor(remaining / 26) - 1;
  } while (remaining >= 0);
  return name;
}
