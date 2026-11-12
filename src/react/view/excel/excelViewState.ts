import { savePersistedState } from "../../common/persistedState.ts";
import { vscodeApi } from "../../util/vscode.ts";
import type Spreadsheet from "./x-spreadsheet/index";
import {
  parseExcelColorMode,
  parseExcelViewState,
  type ExcelColorMode,
  type ExcelViewState,
} from "./excelViewStateModel";

const EXCEL_COLOR_MODE_KEY = "office-excel-color-mode";
const EXCEL_VIEW_PREFIX = "excel-view:";
const LEGACY_VIEW_SUFFIX = "-excel-view";

export type { ExcelColorMode, ExcelViewState } from "./excelViewStateModel";

export function loadExcelColorMode(): ExcelColorMode {
  const state = vscodeApi?.getState?.() as { excelColorMode?: unknown } | undefined;
  const fromHost = parseExcelColorMode(
    typeof state?.excelColorMode === "string" ? state.excelColorMode : null,
  );
  if (fromHost) return fromHost;
  try {
    return parseExcelColorMode(localStorage.getItem(EXCEL_COLOR_MODE_KEY)) ?? "light";
  } catch {
    return "light";
  }
}

export function saveExcelColorMode(mode: ExcelColorMode) {
  try {
    localStorage.setItem(EXCEL_COLOR_MODE_KEY, mode);
  } catch {}
  if (vscodeApi?.setState) {
    const prev = (vscodeApi.getState?.() ?? {}) as Record<string, unknown>;
    vscodeApi.setState({ ...prev, excelColorMode: mode });
  }
}

export function getViewStateKey(documentCacheId: string): string {
  return `${EXCEL_VIEW_PREFIX}${documentCacheId}`;
}

export function loadViewState(documentCacheId: string): ExcelViewState | null {
  if (!documentCacheId) return null;
  try {
    const raw =
      localStorage.getItem(getViewStateKey(documentCacheId)) ??
      localStorage.getItem(`${documentCacheId}${LEGACY_VIEW_SUFFIX}`);
    return parseExcelViewState(raw);
  } catch {
    return null;
  }
}

export function saveViewState(documentCacheId: string, view: ExcelViewState) {
  if (!documentCacheId) return;
  // Bounded storage: one key per document, evicted by the shared helper.
  savePersistedState(EXCEL_VIEW_PREFIX, documentCacheId, view);
}

export function restoreViewState(spreadSheet: Spreadsheet, saved: ExcelViewState) {
  const sheets = spreadSheet.getData();
  if (!sheets.length) return;
  const sheetIndex = Math.min(Math.max(0, saved.sheetIndex), sheets.length - 1);
  // The vendored spreadsheet's SheetData type omits the grid it actually carries.
  const sheet = sheets[sheetIndex] as { rows?: { len?: number }; cols?: { len?: number } };
  const maxRi = Math.max(0, (sheet.rows?.len ?? 1) - 1);
  const maxCi = Math.max(0, (sheet.cols?.len ?? 1) - 1);
  const ri = Math.min(Math.max(0, saved.ri), maxRi);
  const ci = Math.min(Math.max(0, saved.ci), maxCi);
  spreadSheet.scrollToCell(ri, ci, sheetIndex);
}
