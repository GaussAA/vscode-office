import type { SheetSource } from "./sheetSource";

/** Geometry and coordinate rules shared by the windowed sheet and its tests. */
export const ROW_HEIGHT = 22;
export const HEADER_HEIGHT = 38;
export const INDEX_WIDTH = 56;
export const MIN_COLUMN_WIDTH = 140;
export const MAX_COLUMN_WIDTH = 420;
export const OVERSCAN = 4;
export const COPY_FEEDBACK_MS = 1_200;

/**
 * The windowed table freezes row 1 as the header (HEADER_ROWS = 1). Every offset derives from
 * this constant, so toBodySource, fileRowToBodyRow, bodyRowToFileRow, and the initial header
 * read all reference the same rule instead of duplicating magic offsets.
 */
export const HEADER_ROWS = 1;

/** Body source: the file source without its frozen header row(s). */
export function toBodySource(source: SheetSource): SheetSource {
  return {
    ...source,
    rowCount: Math.max(0, source.rowCount - HEADER_ROWS),
    readRows: (start, end) => source.readRows(start + HEADER_ROWS, end + HEADER_ROWS),
  };
}

/**
 * The file is 1-based and row 1 is the frozen header; the body is 0-based and starts at row 2.
 * An out-of-range file row clamps to the body's valid range.
 */
export function fileRowToBodyRow(fileRow: number, fileRowCount: number): number {
  if (fileRowCount <= HEADER_ROWS) return 0;
  const bodyCount = fileRowCount - HEADER_ROWS;
  return Math.max(0, Math.min(fileRow - HEADER_ROWS - 1, bodyCount - 1));
}

/** The grid displays file coordinates, so body row 0 is file row 2. */
export function bodyRowToFileRow(bodyRow: number): number {
  return bodyRow + HEADER_ROWS + 1;
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

export function cellId(row: number, column: number): string {
  return `windowed-sheet-cell-${row}-${column}`;
}

/**
 * The cell text the windowed table shows.
 *
 * Long values are cut instead of wrapped: a windowed row has a fixed height, and one giant
 * cell must not stretch it (the full value is reachable by widening the column or opening the
 * file in the text editor).
 */
export function cellText(value: string | undefined, max = 200): string {
  if (!value) return "";
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/** Header labels, padded to the grid's column count so every cell has a column. */
export function headerCells(rows: string[][], columnCount: number): string[] {
  const first = rows[0] ?? [];
  const labels: string[] = [];
  for (let column = 0; column < columnCount; column++) {
    labels.push(cellText(first[column]) || String(column + 1));
  }
  return labels;
}

/**
 * Parse a jump-to-row input: positive integers jump to that file row (clamped to the body).
 * Invalid input, zero, or negative values return undefined.
 */
export function parseJumpRow(text: string, fileRowCount: number): number | undefined {
  const trimmed = text.replace(/,/g, "").trim();
  const parsed = parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || parsed <= HEADER_ROWS) return undefined;
  return fileRowToBodyRow(parsed, fileRowCount);
}

export { columnLabel as columnName } from "@/common/columnLabel";
