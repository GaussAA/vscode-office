/**
 * Host-side memory cache for parsed windowed workbooks (ADR-0027).
 *
 * The 300k-row probe measured a 6,466 ms whole-workbook parse. Moving that synchronous parse
 * into the extension host would freeze every command and message for those seconds; it would
 * not shorten the first open either, because the rows are needed before anything paints. So
 * the webview keeps parsing on a miss, then hands the row text to this cache. The second open
 * of the same fingerprint skips both the fetch and the parse and asks for windows instead.
 *
 * Values are memory-only: no disk path, no serialization beyond the live session. Two files
 * are kept (LRU); an open view whose entry was evicted must be reopened.
 */
import type { WorkbookSheetRows } from "@/common/workbookRows";
import type { ExcelWorkbookSheetMeta } from "@/common/excelWorkbook";

export const EXCEL_WORKBOOK_CACHE_VERSION = 1;
export const EXCEL_WORKBOOK_CACHE_ENTRIES = 2;
export const EXCEL_WORKBOOK_MAX_SOURCE_BYTES = 15 * 1024 * 1024;

export interface ExcelWorkbookFingerprint {
  key: string;
  size: number;
  mtimeMs: number;
}

export function excelWorkbookCacheKey(fingerprint: ExcelWorkbookFingerprint): string {
  return `${fingerprint.key}:${fingerprint.size}:${fingerprint.mtimeMs}:${EXCEL_WORKBOOK_CACHE_VERSION}`;
}

/** The compact sheet metadata sent to the webview; it never includes the rows themselves. */
export function workbookSheetMeta(sheets: WorkbookSheetRows[]): ExcelWorkbookSheetMeta[] {
  return sheets.map((sheet) => {
    let columnCount = 1;
    for (const row of sheet.rows) columnCount = Math.max(columnCount, row.length);
    return { name: sheet.name, rowCount: sheet.rows.length, columnCount };
  });
}

export class ExcelWorkbookCache {
  private readonly entries = new Map<string, WorkbookSheetRows[]>();

  get(key: string): WorkbookSheetRows[] | null {
    const hit = this.entries.get(key);
    if (!hit) return null;
    // Refresh the LRU position.
    this.entries.delete(key);
    this.entries.set(key, hit);
    return hit;
  }

  set(key: string, sheets: WorkbookSheetRows[]): void {
    this.entries.delete(key);
    this.entries.set(key, sheets);
    while (this.entries.size > EXCEL_WORKBOOK_CACHE_ENTRIES) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}
