/**
 * Pure workbook byte generation for spreadsheet formats.
 *
 * No vscode, no handler, no DOM — just SheetJS + encoding. The writer emits these bytes.
 */
import * as XLSX from "xlsx";
import type { SheetData, RowData } from "./x-spreadsheet/index";
import { encodeCsvText, type CsvEncoding } from "./csvEncoding";
import { bytesToSavePayload, type SaveContentPayload } from "@/common/saveContent";
import { bookTypeFor, kindOf } from "./sheetKind";

function isRowData(row: RowData | number | undefined): row is RowData {
  return row != null && typeof row === "object";
}

const DEFAULT_COL_WIDTH = 100;

function getColWidth(cols: SheetData["cols"], ci: number) {
  const col = cols?.[ci];
  if (col && typeof col === "object" && col.width != null) return col.width;
  return DEFAULT_COL_WIDTH;
}

function applyColWidths(ws: XLSX.WorkSheet, xws: SheetData) {
  const cols = xws.cols;
  if (!cols?.len) return;
  const colWidths: { wpx: number }[] = [];
  for (let ci = 0; ci < cols.len; ci += 1) {
    colWidths.push({ wpx: getColWidth(cols, ci) });
  }
  ws["!cols"] = colWidths;
}

/**
 * Convert one x-spreadsheet SheetData to a SheetJS worksheet.
 */
export function dataToSheetJs(xws: SheetData): XLSX.WorkSheet {
  const aoa: (string | number)[][] = [];
  const rowobj = xws.rows;
  if (!rowobj?.len) return XLSX.utils.aoa_to_sheet([]);

  for (let ri = 0; ri < rowobj.len; ri += 1) {
    const row: (string | number)[] = [];
    const rd = rowobj[ri];
    if (!isRowData(rd) || !rd.cells) {
      aoa.push(row);
      continue;
    }
    const cells = rd.cells;
    const cellKeys = Object.keys(cells)
      .map(Number)
      .filter((n) => !isNaN(n));
    const maxCol = cellKeys.length > 0 ? Math.max(...cellKeys) : 0;

    for (let ci = 0; ci <= maxCol; ci += 1) {
      const cell = cells[ci];
      const text = cell?.text ?? "";

      // Try to parse as number if it looks like one
      if (text && !text.startsWith("=")) {
        const num = Number(text);
        if (!Number.isNaN(num) && String(num) === text.trim()) {
          row.push(num);
          continue;
        }
      }

      row.push(text);
    }
    aoa.push(row);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  applyColWidths(ws, xws);

  // Apply merges
  if (xws.merges && xws.merges.length > 0) {
    ws["!merges"] = xws.merges.map((merge) => XLSX.utils.decode_range(merge));
  }

  return ws;
}

export interface WorkbookBytesOptions {
  csvEncoding?: CsvEncoding;
  csvDelimiter?: string;
}

/**
 * Generate bytes for the given sheets and target extension.
 *
 * @param sheets Array of x-spreadsheet SheetData
 * @param ext Target extension (with or without leading dot, case-insensitive)
 * @param options CSV encoding/delimiter for text formats
 * @returns Uint8Array of the workbook in the requested format
 * @throws Error if the extension is not recognized
 */
export function workbookBytes(
  sheets: SheetData[],
  ext: string,
  options: WorkbookBytesOptions = {},
): Uint8Array {
  const normalized = ext.replace(/^\./, "").toLowerCase();
  const sheetExt = kindOf(`.${normalized}`);
  if (!sheetExt) {
    throw new Error(`Unknown spreadsheet format: ${ext}`);
  }

  // CSV/TSV: encode first sheet as text
  if (sheetExt === ".csv" || sheetExt === ".tsv") {
    const delimiter = sheetExt === ".tsv" ? "\t" : (options.csvDelimiter ?? ",");
    const first = sheets[0];
    const csvContent = first
      ? XLSX.utils.sheet_to_csv(dataToSheetJs(first), { FS: delimiter })
      : "";
    return encodeCsvText(csvContent, options.csvEncoding ?? "utf8");
  }

  // Excel formats: use SheetJS with the correct bookType
  const wb = XLSX.utils.book_new();
  sheets.forEach((s, i) => {
    const ws = dataToSheetJs(s);
    XLSX.utils.book_append_sheet(wb, ws, s.name || `Sheet${i + 1}`);
  });
  const bookType = bookTypeFor(sheetExt);
  const buf = XLSX.write(wb, { bookType, type: "array" });
  return new Uint8Array(buf);
}

/** The host message that carries a finished workbook: write in place, or pick a new file. */
export interface SaveMessage {
  type: "save" | "saveAs";
  payload: SaveContentPayload;
}

/**
 * The one path from sheet data to a host message.
 *
 * `save` overwrites the open document, so it carries no extension (the host keeps the file's own
 * name). `saveAs` carries the normalized extension, lower case and without a dot, because the host
 * builds the default file name as `${base}.${ext}`.
 */
export function saveMessage(
  sheets: SheetData[],
  ext: string,
  mode: "save" | "saveAs",
  options: WorkbookBytesOptions = {},
): SaveMessage {
  const bytes = workbookBytes(sheets, ext, options);
  if (mode === "save") return { type: "save", payload: bytesToSavePayload(bytes) };
  const normalized = ext.replace(/^\./, "").toLowerCase();
  return { type: "saveAs", payload: bytesToSavePayload(bytes, normalized) };
}
