import {
  clearPersistedPrefix,
  isPersistedEntryFresh,
  loadVersionedState,
  saveVersionedState,
} from "../../common/versionedState.ts";
import { vscodeApi } from "../../util/vscode.ts";
import type Spreadsheet from "./x-spreadsheet/index";
import {
  parseExcelColorMode,
  parseExcelViewStateValue,
  type ExcelColorMode,
  type ExcelViewState,
} from "./excelViewStateModel";

const EXCEL_COLOR_MODE_KEY = "office-excel-color-mode";
const EXCEL_VIEW_PREFIX = "excel-view:";
const LEGACY_VIEW_SUFFIX = "-excel-view";
const STATE_VERSION = 1;
const STATE_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

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
  const current = loadVersionedState(EXCEL_VIEW_PREFIX, documentCacheId, {
    version: STATE_VERSION,
    maxAgeMs: STATE_MAX_AGE_MS,
    parse: parseExcelViewStateValue,
    parseLegacy: parseExcelViewStateValue,
  });
  if (current) return current;

  // Pre-version entries lived under `<cacheId>-excel-view`; read one once and migrate it.
  const legacyKey = `${documentCacheId}${LEGACY_VIEW_SUFFIX}`;
  try {
    const raw = localStorage.getItem(legacyKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!isPersistedEntryFresh(parsed, STATE_MAX_AGE_MS)) {
      localStorage.removeItem(legacyKey);
      return null;
    }
    const legacy = parseExcelViewStateValue(parsed);
    if (!legacy) {
      localStorage.removeItem(legacyKey);
      return null;
    }
    saveViewState(documentCacheId, legacy);
    localStorage.removeItem(legacyKey);
    return legacy;
  } catch {
    return null;
  }
}

export function saveViewState(documentCacheId: string, view: ExcelViewState) {
  if (!documentCacheId) return;
  // Bounded storage: one key per document, evicted by the shared helper.
  saveVersionedState(EXCEL_VIEW_PREFIX, documentCacheId, STATE_VERSION, view);
}

/** Remove every per-document Excel view entry (current prefix and the old suffix keys). */
export function clearExcelViewStorage(): void {
  clearPersistedPrefix(EXCEL_VIEW_PREFIX);
  try {
    const keys: string[] = [];
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (key?.endsWith(LEGACY_VIEW_SUFFIX)) keys.push(key);
    }
    for (const key of keys) localStorage.removeItem(key);
  } catch {}
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
