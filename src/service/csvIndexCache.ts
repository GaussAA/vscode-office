/**
 * Host disk cache for the windowed CSV record index (ADR-0028).
 *
 * Only record starts (4 bytes each) and the widest field count are stored; the CSV bytes stay
 * in the webview's source. A hit lets `createTextSheetSource` skip `indexRecordStartsAndFields`
 * while still reading the file bytes for the visible rows.
 */
import type { CsvRecordIndex } from "@/common/csvIndex";
import { isUsableCsvIndex } from "@/common/csvIndex";
import { HostDiskCache } from "@/service/hostDiskCache";

export const CSV_INDEX_VERSION = 1;
export const CSV_INDEX_MAX_BYTES = 16 * 1024 * 1024;
export const CSV_INDEX_MAX_TOTAL_BYTES = 64 * 1024 * 1024;
export const CSV_INDEX_MAX_FILES = 5;
export const CSV_INDEX_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const OFFSET_BYTES = 4;

export interface CsvIndexFingerprint {
  key: string;
  size: number;
  mtimeMs: number;
}

export function csvIndexCacheKey(fingerprint: CsvIndexFingerprint): string {
  return `${fingerprint.key}:${fingerprint.size}:${fingerprint.mtimeMs}:${CSV_INDEX_VERSION}`;
}

interface StoredCsvIndex {
  size?: unknown;
  mtimeMs?: unknown;
  rowCount?: unknown;
  maxFields?: unknown;
}

export class CsvIndexCache {
  private readonly store: HostDiskCache;

  constructor(root: string, now?: () => number) {
    this.store = new HostDiskCache(root, {
      maxEntryBytes: CSV_INDEX_MAX_BYTES,
      maxTotalBytes: CSV_INDEX_MAX_TOTAL_BYTES,
      maxEntries: CSV_INDEX_MAX_FILES,
      ttlMs: CSV_INDEX_TTL_MS,
      now,
    });
  }

  async get(fingerprint: CsvIndexFingerprint): Promise<CsvRecordIndex | null> {
    const entry = await this.store.get(fingerprint.key, CSV_INDEX_VERSION);
    if (!entry) return null;
    const meta = entry.meta.data as StoredCsvIndex;
    if (
      meta.size !== fingerprint.size ||
      meta.mtimeMs !== fingerprint.mtimeMs ||
      typeof meta.rowCount !== "number" ||
      !Number.isInteger(meta.rowCount) ||
      meta.rowCount < 0 ||
      typeof meta.maxFields !== "number" ||
      !Number.isInteger(meta.maxFields) ||
      meta.maxFields < 0 ||
      entry.payload.byteLength !== meta.rowCount * OFFSET_BYTES
    ) {
      await this.store.delete(fingerprint.key);
      return null;
    }
    const rowCount = meta.rowCount;
    const starts: number[] = [];
    const view = new DataView(
      entry.payload.buffer,
      entry.payload.byteOffset,
      entry.payload.byteLength,
    );
    for (let row = 0; row < rowCount; row++) {
      const start = view.getUint32(row * OFFSET_BYTES, true);
      if (start >= fingerprint.size || (row === 0 ? start !== 0 : start <= starts[row - 1])) {
        await this.store.delete(fingerprint.key);
        return null;
      }
      starts.push(start);
    }
    return { starts, maxFields: meta.maxFields };
  }

  async set(fingerprint: CsvIndexFingerprint, index: CsvRecordIndex): Promise<boolean> {
    if (!isUsableCsvIndex(index, fingerprint.size)) return false;
    const payload = Buffer.alloc(index.starts.length * OFFSET_BYTES);
    for (let row = 0; row < index.starts.length; row++) {
      payload.writeUInt32LE(index.starts[row], row * OFFSET_BYTES);
    }
    return this.store.set(
      fingerprint.key,
      CSV_INDEX_VERSION,
      {
        size: fingerprint.size,
        mtimeMs: fingerprint.mtimeMs,
        rowCount: index.starts.length,
        maxFields: index.maxFields,
      },
      payload,
    );
  }

  async clear(): Promise<void> {
    await this.store.clear();
  }
}
