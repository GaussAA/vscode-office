/**
 * Turn a workbook into plain row text (phase 4 of ADR-0017).
 *
 * The editable path converts every cell into an object with style, link, validation and
 * protection fields, then hands it to the grid — that object graph is why a 19 MB workbook
 * costs ~235 MB. The read-only windowed view only needs the text, so this produces one string
 * per cell and drops everything else: roughly 2-3x the file instead of ~9x.
 *
 * Uses SheetJS for all formats now.
 */
import * as XLSX from "xlsx";

export interface WorkbookSheetRows {
  name: string;
  /** Row-major display text; ragged rows are allowed. */
  rows: string[][];
}

/**
 * Rows for every worksheet from a SheetJS workbook.
 *
 * SheetJS decodes workbooks into a cell matrix, so the contract is: one string per cell,
 * ragged rows allowed, blank rows preserved so the sheet does not shift up.
 * `raw: false` asks for the formatted text, which is what the grid shows.
 */
export function workbookRowsFromSheetJs(workbook: XLSX.WorkBook): WorkbookSheetRows[] {
  return workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name];
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      raw: false,
      defval: "",
      blankrows: true,
    });
    const rows = matrix.map((row) => row.map((value) => sheetJsCellText(value)));
    return { name, rows };
  });
}

function sheetJsCellText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return "";
}
