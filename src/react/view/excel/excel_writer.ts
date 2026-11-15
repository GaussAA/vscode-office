import { handler } from "../../util/vscode";
import { bytesToSavePayload } from "@/common/saveContent";
import * as XLSX from "xlsx";
import Spreadsheet from "./x-spreadsheet/index";
import type { RowData, SheetData } from "./x-spreadsheet/index";
import { CsvEncoding, encodeCsvText } from "./csvEncoding";
import { bookTypeFor, kindOf } from "./sheetKind";

// Re-export formatting utilities from excel_meta
export { buildFormattingSnapshot, hasFormattingChanged } from "./excel_meta";

export interface ExportOptions {
  /** 通过另存为对话框保存，而非覆盖当前文件 */
  saveAs?: boolean;
  /** saveAs 时指定目标格式 */
  saveAsExt?: string;
}

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

function dataToSheetJs(xws: SheetData): XLSX.WorkSheet {
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

function _exportWithSheetJs(sheets: SheetData[], ext: string) {
  const wb = XLSX.utils.book_new();
  sheets.forEach((s, i) => {
    const ws = dataToSheetJs(s);
    XLSX.utils.book_append_sheet(wb, ws, s.name || `Sheet${i + 1}`);
  });
  const buf = XLSX.write(wb, { bookType: ext as XLSX.BookType, type: "array" });
  handler.emit("save", bytesToSavePayload(new Uint8Array(buf)));
}

async function emitSave(buffer: Uint8Array, options?: ExportOptions) {
  if (options?.saveAs) {
    const ext = options.saveAsExt ?? "xlsx";
    handler.emit("saveAs", bytesToSavePayload(buffer, ext));
  } else {
    handler.emit("save", bytesToSavePayload(buffer));
  }
}

export async function export_to(
  spreadSheet: Spreadsheet,
  targetExt: string,
  csvEncoding: CsvEncoding = "utf8",
  csvDelimiter: string = ",",
) {
  const ext = targetExt.replace(".", "").toLowerCase();
  const sheets = spreadSheet.getData();

  if (ext === "csv" || ext === "tsv") {
    const fs = ext === "tsv" ? "\t" : csvDelimiter;
    const csvContent = XLSX.utils.sheet_to_csv(dataToSheetJs(sheets[0]), { FS: fs });
    const bytes = encodeCsvText(csvContent, csvEncoding);
    handler.emit("saveAs", bytesToSavePayload(bytes, ext));
    return;
  }

  // For all Excel formats, use SheetJS
  const wb = XLSX.utils.book_new();
  sheets.forEach((s, i) => {
    const ws = dataToSheetJs(s);
    XLSX.utils.book_append_sheet(wb, ws, s.name || `Sheet${i + 1}`);
  });
  const buf = XLSX.write(wb, { bookType: ext as XLSX.BookType, type: "array" });
  handler.emit("saveAs", bytesToSavePayload(new Uint8Array(buf), ext));
}

export async function export_xlsx(
  spreadSheet: Spreadsheet,
  extName: string,
  csvEncoding: CsvEncoding = "utf8",
  options?: ExportOptions,
  csvDelimiter: string = ",",
) {
  const ext = extName.replace(".", "").toLowerCase();
  const sheets = spreadSheet.getData();

  if (ext === "csv" || ext === "tsv") {
    const fs = ext === "tsv" ? "\t" : csvDelimiter;
    const csvContent = XLSX.utils.sheet_to_csv(dataToSheetJs(sheets[0]), { FS: fs });
    const bytes = encodeCsvText(csvContent, csvEncoding);
    handler.emit("save", bytesToSavePayload(bytes));
    return;
  }

  // For all Excel formats, use SheetJS with the correct bookType
  const wb = XLSX.utils.book_new();
  sheets.forEach((s, i) => {
    const ws = dataToSheetJs(s);
    XLSX.utils.book_append_sheet(wb, ws, s.name || `Sheet${i + 1}`);
  });
  const sheetExt = kindOf(extName);
  const bookType = sheetExt ? bookTypeFor(sheetExt) : "xlsx";
  const buf = XLSX.write(wb, { bookType, type: "array" });
  await emitSave(new Uint8Array(buf), options);
}

// Alias for backward compatibility
export const exportSaveAs = export_to;
