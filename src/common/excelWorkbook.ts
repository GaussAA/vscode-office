/**
 * Host <-> webview contract for the cached windowed workbook (ADR-0027).
 *
 * The webview parses a workbook on a cache miss and sends the row text to the host; a later
 * open of the same fingerprint asks the host for metadata and then for row windows. Values
 * stay in memory on both sides — nothing here is written to disk.
 */
import type { WorkbookSheetRows } from "./workbookRows";

export interface ExcelWorkbookSheetMeta {
  name: string;
  rowCount: number;
  columnCount: number;
}

export interface ExcelWorkbookOpenRequest {
  requestId: number;
}

export interface ExcelWorkbookMetaPayload {
  requestId: number;
  /** Present on a hit and on a miss (the key the webview must use for its store/rows). */
  key?: string;
  sheets?: ExcelWorkbookSheetMeta[];
  /** The host has no cached entry for the current fingerprint. */
  missing?: boolean;
}

export interface ExcelWorkbookRowsRequest {
  requestId: number;
  key: string;
  sheetIndex: number;
  start: number;
  end: number;
}

export interface ExcelWorkbookRowsPayload {
  requestId: number;
  rows?: string[][];
  error?: string;
}

export interface ExcelWorkbookStoreRequest {
  sheets: WorkbookSheetRows[];
}
