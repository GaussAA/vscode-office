import * as XLSX from "xlsx";
import { parseCsv } from "./csvParser";
import { decodeCsvBufferWithEncoding, type CsvEncoding } from "./csvEncoding";
import type { CellData, SheetData } from "./x-spreadsheet/index";
import { workbookRowsFromSheetJs, type WorkbookSheetRows } from "./workbookRows";

type RowMap = NonNullable<SheetData["rows"]>;

export interface ExcelData {
  sheets: SheetData[];
  maxCols: number;
  maxLength?: number;
  /** Detected column delimiter when loading CSV/TSV */
  csvDelimiter?: string;
  /** Encoding chosen while decoding CSV/TSV; the writer reuses it instead of guessing. */
  csvEncoding?: CsvEncoding;
}

const MIN_COL_WIDTH = 70;
const MAX_COL_WIDTH = 300;
const DEFAULT_COL_WIDTH = 100;
const CHAR_WIDTH = 8;
const MAX_ROWS_TO_CHECK = 10;

const clampColWidth = (width: number) => Math.min(Math.max(width, MIN_COL_WIDTH), MAX_COL_WIDTH);

const calculateColWidth = (rows: any[], colIndex: number): number => {
  let maxLength = 0;
  for (let i = 0; i < Math.min(rows.length, MAX_ROWS_TO_CHECK); i += 1) {
    const cell = rows[i][colIndex];
    if (cell) {
      const length = String(cell).length;
      if (length > maxLength) {
        maxLength = length;
      }
    }
  }
  return clampColWidth(maxLength * CHAR_WIDTH);
};

// Utility functions for potential future use
const _excelColWidthToPx = (width?: number) => {
  if (width == null) return null;
  return Math.round(width * 7 + 5);
};

const readSheetJsMerges = (worksheet: XLSX.WorkSheet) =>
  (worksheet["!merges"] ?? []).map((merge) => XLSX.utils.encode_range(merge));

const _expandSizeForMerge = (merge: string, size: { maxRow: number; maxCols: number }) => {
  const range = XLSX.utils.decode_range(merge);
  size.maxRow = Math.max(size.maxRow, range.e.r + 1);
  size.maxCols = Math.max(size.maxCols, range.e.c + 1);
};

const expandSizeForSheetJsMerge = (
  merge: XLSX.Range,
  size: { maxRow: number; maxCols: number },
) => {
  size.maxRow = Math.max(size.maxRow, merge.e.r + 1);
  size.maxCols = Math.max(size.maxCols, merge.e.c + 1);
};

const buildCsvCols = (rows: any[][], colCount: number) => {
  const cols: Record<number, { width: number }> = {};
  for (let i = 0; i < colCount; i += 1) {
    cols[i] = { width: calculateColWidth(rows, i) };
  }
  return cols;
};

/**
 * Rows-only load for the windowed view (ADR-0017 phase 4).
 * Uses SheetJS for all workbook formats.
 */
export async function loadWorkbookRows(buffer: ArrayBuffer): Promise<WorkbookSheetRows[]> {
  return workbookRowsFromSheetJs(XLSX.read(buffer, { type: "array" }));
}

const sheetJsColWidthToPx = (col?: XLSX.ColInfo) => {
  if (!col) return null;
  if (col.wpx != null) return col.wpx;
  if (col.wch != null) return col.wch * CHAR_WIDTH;
  if (col.width != null) return col.width * CHAR_WIDTH;
  return null;
};

const buildColsFromSheetJsWorksheet = (worksheet: XLSX.WorkSheet, colCount: number) => {
  const cols: Record<number, { width: number }> = {};
  const sheetCols = worksheet["!cols"];
  for (let i = 0; i < colCount; i += 1) {
    const width = sheetJsColWidthToPx(sheetCols?.[i]) ?? DEFAULT_COL_WIDTH;
    cols[i] = { width: clampColWidth(width) };
  }
  return cols;
};

const formatSheetJsCell = (cell: XLSX.CellObject) => {
  if (cell.w) return cell.w;
  if (cell.v == null) return "";
  if (cell.v instanceof Date) return cell.v.toISOString().slice(0, 10);
  return String(cell.v);
};

const convertSheetJsWorksheet = (
  worksheet: XLSX.WorkSheet,
): Pick<SheetData, "rows" | "cols" | "merges"> => {
  const rows: RowMap = {};
  let maxCols = 0;
  let maxRow = 0;
  const ref = worksheet["!ref"];
  if (!ref) {
    return { rows: { len: 0 }, cols: { len: 0 } };
  }

  const range = XLSX.utils.decode_range(ref);
  for (let ri = range.s.r; ri <= range.e.r; ri += 1) {
    const cells: Record<number, CellData> = {};
    let hasContent = false;
    for (let ci = range.s.c; ci <= range.e.c; ci += 1) {
      const addr = XLSX.utils.encode_cell({ r: ri, c: ci });
      const cell = worksheet[addr];
      if (!cell) continue;
      const text = formatSheetJsCell(cell);
      if (!text) continue;
      cells[ci] = { text };
      hasContent = true;
      if (ci + 1 > maxCols) maxCols = ci + 1;
      if (ri + 1 > maxRow) maxRow = ri + 1;
    }
    if (hasContent) {
      rows[ri] = { cells };
    }
  }

  const sheetSize = { maxRow, maxCols };
  (worksheet["!merges"] ?? []).forEach((merge) => expandSizeForSheetJsMerge(merge, sheetSize));
  maxRow = sheetSize.maxRow;
  maxCols = sheetSize.maxCols;

  const colCount = Math.max(maxCols, range.e.c - range.s.c + 1);
  const merges = readSheetJsMerges(worksheet);
  return {
    rows: { len: maxRow, ...rows },
    cols: { len: colCount, ...buildColsFromSheetJsWorksheet(worksheet, colCount) },
    merges: merges.length > 0 ? merges : undefined,
  };
};

const convertSheetJsWorkbook = (workbook: XLSX.WorkBook): ExcelData => {
  const sheets: SheetData[] = [];
  let maxLength = 0;
  let maxCols = 26;

  for (const sheetName of workbook.SheetNames) {
    const converted = convertSheetJsWorksheet(workbook.Sheets[sheetName]);
    const rowCount = converted.rows?.len ?? 0;
    if (maxLength < rowCount) maxLength = rowCount;

    const colLen = converted.cols?.len ?? 0;
    if (colLen > maxCols) maxCols = colLen;

    sheets.push({
      name: sheetName,
      rows: converted.rows,
      cols: converted.cols,
      ...(converted.merges ? { merges: converted.merges } : {}),
    });
  }

  return { sheets, maxLength, maxCols };
};

const loadWithSheetJs = (buffer: ArrayBuffer): ExcelData => {
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  return convertSheetJsWorkbook(workbook);
};

const loadCsv = (buffer: ArrayBuffer, delimiter?: string): ExcelData => {
  let maxCols = 26;
  const decoded = decodeCsvBufferWithEncoding(buffer);
  const emptySheet = {
    maxCols,
    csvEncoding: decoded.encoding,
    sheets: [{ name: "Sheet1", rows: { len: 0 } }],
  };
  const csvStr = decoded.text;
  if (!csvStr) return emptySheet;

  const { rows, delimiter: csvDelimiter } = parseCsv(csvStr, delimiter);
  const colCount = rows.reduce((max, row) => Math.max(max, row.length), 0);

  const processedRows: RowMap = {};
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const cells: Record<number, CellData> = {};
    for (let j = 0; j < row.length; j += 1) {
      cells[j] = { text: row[j] == null ? "" : String(row[j]) };
      if (j + 1 > maxCols) maxCols = j + 1;
    }
    processedRows[i] = { cells };
  }

  return {
    maxCols,
    maxLength: rows.length,
    csvDelimiter,
    csvEncoding: decoded.encoding,
    sheets: [
      {
        name: "Sheet1",
        rows: { len: rows.length, ...processedRows },
        cols: { len: colCount, ...buildCsvCols(rows, colCount) },
      },
    ],
  };
};

const isCsvExt = (ext: string) => /csv|tsv/.test(ext.toLowerCase());
const _isOdsExt = (ext: string) => ext.toLowerCase().includes("ods");
const _isXlsExt = (ext: string) => ext.toLowerCase().replace(/^\./, "") === "xls";

export async function loadSheets(buffer: ArrayBuffer, ext: string): Promise<ExcelData> {
  if (isCsvExt(ext)) {
    return loadCsv(buffer, ext.toLowerCase().replace(/^\./, "") === "tsv" ? "\t" : undefined);
  }
  // Use SheetJS for all Excel formats: .xlsx, .xls, .ods
  return loadWithSheetJs(buffer);
}

export function readCSV(buffer: ArrayBuffer): ExcelData {
  return loadCsv(buffer);
}

export async function readExcel(buffer: ArrayBuffer): Promise<ExcelData> {
  // Use SheetJS for all .xlsx files
  return loadWithSheetJs(buffer);
}
