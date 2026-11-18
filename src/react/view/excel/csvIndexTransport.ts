/**
 * Webview side of the CSV index cache (ADR-0028): request/response correlation for the
 * `excelCsvIndex*` messages. The host owns the disk entry; this only asks and stores.
 */
import type { CsvRecordIndex, ExcelCsvIndexMetaPayload } from "@/common/csvIndex";
import type { WorkbookTransportEvents } from "./hostWorkbookTransport";

export interface HostCsvIndex extends CsvRecordIndex {
  key: string;
}

export interface CsvIndexTransport {
  open(): Promise<HostCsvIndex | null>;
  store(index: CsvRecordIndex): void;
  dispose(): void;
}

const DEFAULT_TIMEOUT_MS = 4000;

export function createCsvIndexTransport(
  events: WorkbookTransportEvents,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): CsvIndexTransport {
  let nextRequestId = 0;
  const waiters = new Map<number, (index: HostCsvIndex | null) => void>();
  const timers = new Map<number, ReturnType<typeof setTimeout>>();

  events.on("excelCsvIndexMeta", (payload: ExcelCsvIndexMetaPayload) => {
    if (typeof payload?.requestId !== "number") return;
    const settle = waiters.get(payload.requestId);
    if (!settle) return;
    waiters.delete(payload.requestId);
    const timer = timers.get(payload.requestId);
    if (timer) {
      clearTimeout(timer);
      timers.delete(payload.requestId);
    }
    if (
      payload.missing ||
      typeof payload.key !== "string" ||
      !Array.isArray(payload.starts) ||
      typeof payload.maxFields !== "number"
    ) {
      settle(null);
      return;
    }
    settle({ key: payload.key, starts: payload.starts, maxFields: payload.maxFields });
  });

  return {
    open(): Promise<HostCsvIndex | null> {
      return new Promise((resolve) => {
        const requestId = ++nextRequestId;
        waiters.set(requestId, resolve);
        timers.set(
          requestId,
          setTimeout(() => {
            waiters.delete(requestId);
            timers.delete(requestId);
            resolve(null);
          }, timeoutMs),
        );
        events.emit("excelCsvIndexOpen", { requestId });
      });
    },

    store(index: CsvRecordIndex): void {
      events.emit("excelCsvIndexStore", {
        starts: index.starts,
        maxFields: index.maxFields,
      });
    },

    dispose(): void {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      for (const settle of waiters.values()) settle(null);
      waiters.clear();
    },
  };
}
