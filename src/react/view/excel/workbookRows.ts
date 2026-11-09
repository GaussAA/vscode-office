/**
 * Turn a workbook into plain row text (phase 4 of ADR-0017).
 *
 * The editable path converts every cell into an object with style, link, validation and
 * protection fields, then hands it to the grid — that object graph is why a 19 MB workbook
 * costs ~235 MB. The read-only windowed view only needs the text, so this produces one string
 * per cell and drops everything else: roughly 2-3x the file instead of ~9x.
 *
 * ExcelJS's browser build cannot be imported from plain Node ESM, so this module takes the
 * workbook as an argument and stays testable; the caller owns the ExcelJS load.
 */
import type * as ExcelJS from "@cweijan/exceljs";

export interface WorkbookSheetRows {
  name: string;
  /** Row-major display text; ragged rows are allowed (columns are padded when rendered). */
  rows: string[][];
}

/** The text a read-only cell shows. Formulas keep their `=` form, like the grid shows them. */
export function workbookCellText(cell: ExcelJS.Cell): string {
  const value = cell.value;
  if (value == null) return "";
  if (typeof value === "object") {
    if ("formula" in value || "sharedFormula" in value) {
      const formula = (value as { formula?: string }).formula;
      return formula ? `=${formula}` : (cell.text ?? "");
    }
    if ("hyperlink" in value) {
      const link = value as ExcelJS.CellHyperlinkValue;
      return link.text || link.hyperlink || "";
    }
    if (value instanceof Date) return value.toISOString().slice(0, 10);
  }
  if (cell.text) return cell.text;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  // Rich text and error values have no useful primitive form; ExcelJS's own display text is
  // the best answer available (and `cell.text` was already empty above).
  return "";
}

/**
 * Rows for every worksheet, as display text.
 *
 * `rowCount`/`columnCount` come from the worksheet itself so an empty trailing row still
 * produces a row of empty cells instead of shifting the sheet up.
 */
export function workbookRows(workbook: ExcelJS.Workbook): WorkbookSheetRows[] {
  return workbook.worksheets.map((worksheet) => {
    const rows: string[][] = [];
    const rowCount = Math.max(0, worksheet.rowCount || 0);
    const columnCount = Math.max(0, worksheet.columnCount || 0);
    for (let rowNumber = 1; rowNumber <= rowCount; rowNumber++) {
      const row = worksheet.getRow(rowNumber);
      const cells: string[] = [];
      for (let column = 1; column <= columnCount; column++) {
        cells.push(workbookCellText(row.getCell(column)));
      }
      rows.push(cells);
    }
    return { name: worksheet.name, rows };
  });
}
