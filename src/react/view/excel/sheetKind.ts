/**
 * Centralized spreadsheet format classification.
 *
 * This module is the single source of truth for extension validation, view selection, size limits,
 * and write format mapping. Before this, the same extension sets were duplicated across 6-7 files,
 * and the writer used a hardcoded `"xlsx"` bookType for every format.
 */
import * as XLSX from "xlsx";
import { SPREADSHEET_PREVIEW_LIMITS, type SpreadsheetKind } from "@/common/previewLimit";

/** Supported spreadsheet extensions (with dot). */
export type SheetExtension = ".xlsx" | ".xlsm" | ".xls" | ".ods" | ".csv" | ".tsv";

/** All supported sheet extensions. */
export const SHEET_EXTENSIONS = new Set<string>([".xlsx", ".xlsm", ".xls", ".ods", ".csv", ".tsv"]);

/** Legacy binary formats that require SheetJS instead of the removed ExcelJS path. */
export const LEGACY_FORMATS = new Set<string>([".xls", ".ods"]);

/** Text formats (CSV/TSV). */
const TEXT_FORMATS = new Set<string>([".csv", ".tsv"]);

/** Modern workbook formats (ZIP containers). */
const WORKBOOK_FORMATS = new Set<string>([".xlsx", ".xlsm", ".xls", ".ods"]);

/**
 * Normalize and validate a file extension.
 *
 * Returns a canonical `SheetExtension` or `null` if the extension is not recognized.
 */
export function kindOf(ext: string): SheetExtension | null {
  const normalized = ext.toLowerCase();
  return SHEET_EXTENSIONS.has(normalized) ? (normalized as SheetExtension) : null;
}

/**
 * Which view a spreadsheet gets: the editable grid or the read-only windowed table.
 *
 * - `.csv`/`.tsv` → "spreadsheet" (grid with cells)
 * - `.xlsx`/`.xlsm`/`.xls`/`.ods` → "windowed" (read-only rows)
 *
 * This consolidates the logic previously in `sheetViewFor` and `excelWindowKind`.
 */
export function viewFor(ext: SheetExtension): "spreadsheet" | "windowed" {
  if (TEXT_FORMATS.has(ext)) return "spreadsheet";
  if (WORKBOOK_FORMATS.has(ext)) return "windowed";
  // Unreachable with a valid SheetExtension
  return "spreadsheet";
}

/**
 * Size limit in bytes for a given format.
 *
 * - Text formats: 25 MB (generous, ~2s to parse)
 * - Workbooks: 15 MB (zip + shared strings + styles, most expensive per byte)
 *
 * This consolidates the limit selection previously duplicated in `limitForView` and
 * `previewLimitBytes`.
 */
export function limitFor(ext: SheetExtension): number {
  const kind: SpreadsheetKind = TEXT_FORMATS.has(ext) ? "text" : "workbook";
  return SPREADSHEET_PREVIEW_LIMITS[kind];
}

/**
 * SheetJS bookType for writing a file with the given extension.
 *
 * Before this function, the writer always used `"xlsx"`, which meant `.xls` and `.ods` files
 * were saved with xlsx bytes.
 */
export function bookTypeFor(ext: SheetExtension): XLSX.BookType {
  switch (ext) {
    case ".xlsx":
      return "xlsx";
    case ".xlsm":
      return "xlsm";
    case ".xls":
      return "xls";
    case ".ods":
      return "ods";
    case ".csv":
      return "csv";
    case ".tsv":
      return "txt"; // SheetJS uses "txt" for TSV with tab delimiter
    default:
      // Exhaustiveness check: this should never execute with a valid SheetExtension
      const _: never = ext;
      return "xlsx";
  }
}
