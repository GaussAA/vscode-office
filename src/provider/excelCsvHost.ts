/**
 * Host half of the CSV record index cache (ADR-0028). The provider injects the stat; the cache
 * and message decisions live here and stay unit-testable without `vscode`.
 */
import type {
  CsvRecordIndex,
  ExcelCsvIndexMetaPayload,
  ExcelCsvIndexOpenRequest,
  ExcelCsvIndexStoreRequest,
} from "@/common/csvIndex";
import { type CsvIndexCache, csvIndexCacheKey } from "@/service/csvIndexCache";

export interface ExcelCsvHostOptions {
  documentCacheId: string;
  cache: CsvIndexCache;
  stat: () => Promise<{ size: number; mtimeMs: number } | null>;
  emit: (type: string, payload: unknown) => void;
}

export interface HostCsvIndex extends CsvRecordIndex {
  key: string;
}

export function createExcelCsvHost(options: ExcelCsvHostOptions) {
  const { documentCacheId, cache, stat, emit } = options;

  const fingerprint = async () => {
    let value: { size: number; mtimeMs: number } | null;
    try {
      value = await stat();
    } catch {
      value = null;
    }
    if (!value) return null;
    return { key: documentCacheId, ...value };
  };

  return {
    async open(request?: Partial<ExcelCsvIndexOpenRequest>): Promise<HostCsvIndex | null> {
      if (typeof request?.requestId !== "number") return null;
      const fp = await fingerprint();
      if (!fp) {
        emit("excelCsvIndexMeta", { requestId: request.requestId, missing: true });
        return null;
      }
      const key = csvIndexCacheKey(fp);
      const index = await cache.get(fp);
      if (!index) {
        const payload: ExcelCsvIndexMetaPayload = {
          requestId: request.requestId,
          missing: true,
          key,
        };
        emit("excelCsvIndexMeta", payload);
        return null;
      }
      const payload: ExcelCsvIndexMetaPayload = {
        requestId: request.requestId,
        key,
        starts: index.starts,
        maxFields: index.maxFields,
      };
      emit("excelCsvIndexMeta", payload);
      return { key, ...index };
    },

    async store(request?: Partial<ExcelCsvIndexStoreRequest>): Promise<boolean> {
      const starts = request?.starts;
      const maxFields = request?.maxFields;
      if (
        !Array.isArray(starts) ||
        typeof maxFields !== "number" ||
        !Number.isInteger(maxFields) ||
        maxFields < 0
      ) {
        return false;
      }
      const fp = await fingerprint();
      if (!fp) return false;
      return cache.set(fp, { starts, maxFields });
    },
  };
}
