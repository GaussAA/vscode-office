/**
 * Host half of the cached windowed workbook (ADR-0027). It owns the fingerprint stat, the
 * shared memory cache and the three messages: open (metadata), rows (a window) and store
 * (the webview's parse result).
 *
 * Deliberately no `vscode` import: the provider injects the stat, so the message decisions can
 * be driven by unit tests without a real workspace.
 */
import type { WorkbookSheetRows } from "@/common/workbookRows";
import type {
  ExcelWorkbookMetaPayload,
  ExcelWorkbookOpenRequest,
  ExcelWorkbookRowsPayload,
  ExcelWorkbookRowsRequest,
  ExcelWorkbookStoreRequest,
} from "@/common/excelWorkbook";
import {
  EXCEL_WORKBOOK_MAX_SOURCE_BYTES,
  type ExcelWorkbookCache,
  excelWorkbookCacheKey,
  workbookSheetMeta,
} from "@/service/excelWorkbookCache";

export interface ExcelWorkbookStat {
  size: number;
  mtimeMs: number;
}

export interface ExcelWorkbookHostOptions {
  documentCacheId: string;
  cache: ExcelWorkbookCache;
  stat: () => Promise<ExcelWorkbookStat | null>;
  emit: (type: string, payload: unknown) => void;
}

export function createExcelWorkbookHost(options: ExcelWorkbookHostOptions) {
  const { documentCacheId, cache, stat, emit } = options;

  const keyFor = async (): Promise<string | null> => {
    let value: ExcelWorkbookStat | null;
    try {
      value = await stat();
    } catch {
      value = null;
    }
    if (!value || value.size > EXCEL_WORKBOOK_MAX_SOURCE_BYTES) return null;
    return excelWorkbookCacheKey({ key: documentCacheId, ...value });
  };

  return {
    async open(request?: Partial<ExcelWorkbookOpenRequest>) {
      if (typeof request?.requestId !== "number") return;
      const key = await keyFor();
      if (!key) {
        emit("excelWorkbookMeta", { requestId: request.requestId, missing: true });
        return;
      }
      const sheets = cache.get(key);
      if (!sheets) {
        emit("excelWorkbookMeta", { requestId: request.requestId, missing: true, key });
        return;
      }
      const payload: ExcelWorkbookMetaPayload = {
        requestId: request.requestId,
        key,
        sheets: workbookSheetMeta(sheets),
      };
      emit("excelWorkbookMeta", payload);
    },

    async rows(request?: Partial<ExcelWorkbookRowsRequest>) {
      if (typeof request?.requestId !== "number" || typeof request.key !== "string") return;
      const sheets = cache.get(request.key);
      if (!sheets) {
        const payload: ExcelWorkbookRowsPayload = {
          requestId: request.requestId,
          error: "Workbook cache entry is gone; reopen the file.",
        };
        emit("excelWorkbookRows", payload);
        return;
      }
      const sheetIndex = Math.max(
        0,
        Math.min(sheets.length - 1, Math.trunc(request.sheetIndex ?? 0)),
      );
      const rows = sheets[sheetIndex]?.rows ?? [];
      const start = Math.max(0, Math.min(rows.length, Math.trunc(request.start ?? 0)));
      const end = Math.max(start, Math.min(rows.length, Math.trunc(request.end ?? start)));
      const payload: ExcelWorkbookRowsPayload = {
        requestId: request.requestId,
        rows: rows.slice(start, end),
      };
      emit("excelWorkbookRows", payload);
    },

    async store(request?: Partial<ExcelWorkbookStoreRequest>) {
      const sheets = request?.sheets;
      if (!isWorkbookSheets(sheets)) return;
      const key = await keyFor();
      if (!key) return;
      cache.set(key, sheets);
    },
  };
}

/** Shallow shape check; the deep cell values came from our own parser over the bridge. */
function isWorkbookSheets(value: unknown): value is WorkbookSheetRows[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (sheet) =>
        !!sheet &&
        typeof sheet === "object" &&
        typeof (sheet as { name?: unknown }).name === "string" &&
        Array.isArray((sheet as { rows?: unknown }).rows),
    )
  );
}
