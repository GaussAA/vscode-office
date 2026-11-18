/**
 * Webview side of the host workbook cache (ADR-0027): request/response correlation around the
 * `excelWorkbook*` messages. The host owns the values; this module only turns a request into a
 * promise and a late reply into a no-op.
 */
import type { ExcelWorkbookMetaPayload, ExcelWorkbookRowsPayload } from "@/common/excelWorkbook";
import type { WorkbookSheetRows } from "@/common/workbookRows";
import type { HostWorkbookMeta } from "./hostWorkbookSource";

export interface WorkbookTransportEvents {
  on(type: string, callback: (content: any) => void): unknown;
  emit(type: string, payload: unknown): void;
}

export interface HostWorkbookTransport {
  open(): Promise<HostWorkbookMeta | null>;
  rows(key: string, sheetIndex: number, start: number, end: number): Promise<string[][]>;
  store(sheets: WorkbookSheetRows[]): void;
  dispose(): void;
}

const DEFAULT_TIMEOUT_MS = 4000;

export function createHostWorkbookTransport(
  events: WorkbookTransportEvents,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): HostWorkbookTransport {
  let nextRequestId = 0;
  const metaWaiters = new Map<number, (meta: HostWorkbookMeta | null) => void>();
  const rowWaiters = new Map<
    number,
    { resolve: (rows: string[][]) => void; reject: (cause: Error) => void }
  >();
  const timers = new Map<number, ReturnType<typeof setTimeout>>();

  const clearTimer = (requestId: number) => {
    const timer = timers.get(requestId);
    if (timer) {
      clearTimeout(timer);
      timers.delete(requestId);
    }
  };

  events.on("excelWorkbookMeta", (payload: ExcelWorkbookMetaPayload) => {
    if (typeof payload?.requestId !== "number") return;
    const settle = metaWaiters.get(payload.requestId);
    if (!settle) return;
    metaWaiters.delete(payload.requestId);
    clearTimer(payload.requestId);
    if (payload.missing || !payload.key || !payload.sheets) {
      settle(null);
      return;
    }
    settle({ key: payload.key, sheets: payload.sheets });
  });

  events.on("excelWorkbookRows", (payload: ExcelWorkbookRowsPayload) => {
    if (typeof payload?.requestId !== "number") return;
    const waiter = rowWaiters.get(payload.requestId);
    if (!waiter) return;
    rowWaiters.delete(payload.requestId);
    clearTimer(payload.requestId);
    if (payload.error) {
      waiter.reject(new Error(payload.error));
      return;
    }
    waiter.resolve(payload.rows ?? []);
  });

  return {
    open(): Promise<HostWorkbookMeta | null> {
      return new Promise((resolve) => {
        const requestId = ++nextRequestId;
        metaWaiters.set(requestId, resolve);
        timers.set(
          requestId,
          setTimeout(() => {
            metaWaiters.delete(requestId);
            timers.delete(requestId);
            resolve(null);
          }, timeoutMs),
        );
        events.emit("excelWorkbookOpen", { requestId });
      });
    },

    rows(key: string, sheetIndex: number, start: number, end: number): Promise<string[][]> {
      return new Promise((resolve, reject) => {
        const requestId = ++nextRequestId;
        rowWaiters.set(requestId, { resolve, reject });
        timers.set(
          requestId,
          setTimeout(() => {
            rowWaiters.delete(requestId);
            timers.delete(requestId);
            reject(new Error("The workbook window read timed out."));
          }, timeoutMs),
        );
        events.emit("excelWorkbookRows", { requestId, key, sheetIndex, start, end });
      });
    },

    store(sheets: WorkbookSheetRows[]): void {
      events.emit("excelWorkbookStore", { sheets });
    },

    dispose(): void {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      for (const settle of metaWaiters.values()) settle(null);
      metaWaiters.clear();
      for (const waiter of rowWaiters.values()) {
        waiter.reject(new Error("The workbook was closed."));
      }
      rowWaiters.clear();
    },
  };
}
