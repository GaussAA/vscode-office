/**
 * Host disk cache for the JSON Preview's top-level record ranges (ADR-0028).
 *
 * Only `{start,end}` offsets into the text are stored (8 bytes per record); the text itself
 * stays in the host session and is never written. A hit lets `JsonPreviewSession` skip the
 * `indexJsonArray` scan while still reading the document text.
 */
import type { JsonRecordRange } from "@/service/jsonPreview";
import { isUsableRecordRanges } from "@/common/jsonPreviewTypes";
import { HostDiskCache } from "@/service/hostDiskCache";

export const JSON_PREVIEW_RANGE_VERSION = 1;
export const JSON_PREVIEW_RANGE_MAX_BYTES = 16 * 1024 * 1024;
export const JSON_PREVIEW_RANGE_MAX_TOTAL_BYTES = 64 * 1024 * 1024;
export const JSON_PREVIEW_RANGE_MAX_FILES = 5;
export const JSON_PREVIEW_RANGE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const RANGE_BYTES = 8;

export interface JsonRangeFingerprint {
  key: string;
  size: number;
  mtimeMs: number;
}

export function jsonPreviewRangeKey(fingerprint: JsonRangeFingerprint): string {
  return `${fingerprint.key}:${fingerprint.size}:${fingerprint.mtimeMs}:${JSON_PREVIEW_RANGE_VERSION}`;
}

interface StoredRangeMeta {
  size?: unknown;
  mtimeMs?: unknown;
  recordCount?: unknown;
}

export class JsonPreviewRangeCache {
  private readonly store: HostDiskCache;

  constructor(root: string, now?: () => number) {
    this.store = new HostDiskCache(root, {
      maxEntryBytes: JSON_PREVIEW_RANGE_MAX_BYTES,
      maxTotalBytes: JSON_PREVIEW_RANGE_MAX_TOTAL_BYTES,
      maxEntries: JSON_PREVIEW_RANGE_MAX_FILES,
      ttlMs: JSON_PREVIEW_RANGE_TTL_MS,
      now,
    });
  }

  async get(fingerprint: JsonRangeFingerprint): Promise<JsonRecordRange[] | null> {
    const entry = await this.store.get(fingerprint.key, JSON_PREVIEW_RANGE_VERSION);
    if (!entry) return null;
    const meta = entry.meta.data as StoredRangeMeta;
    if (
      meta.size !== fingerprint.size ||
      meta.mtimeMs !== fingerprint.mtimeMs ||
      typeof meta.recordCount !== "number" ||
      !Number.isInteger(meta.recordCount) ||
      meta.recordCount < 0 ||
      entry.payload.byteLength !== meta.recordCount * RANGE_BYTES
    ) {
      await this.store.delete(fingerprint.key);
      return null;
    }
    const view = new DataView(
      entry.payload.buffer,
      entry.payload.byteOffset,
      entry.payload.byteLength,
    );
    const ranges: JsonRecordRange[] = [];
    let previousEnd = -1;
    for (let index = 0; index < meta.recordCount; index++) {
      const start = view.getUint32(index * RANGE_BYTES, true);
      const end = view.getUint32(index * RANGE_BYTES + 4, true);
      if (start < previousEnd || end <= start || end > 0xffff_ffff) {
        await this.store.delete(fingerprint.key);
        return null;
      }
      ranges.push({ start, end });
      previousEnd = end;
    }
    return ranges;
  }

  async set(fingerprint: JsonRangeFingerprint, ranges: JsonRecordRange[]): Promise<boolean> {
    if (!isUsableRecordRanges(ranges, Number.MAX_SAFE_INTEGER)) return false;
    const payload = Buffer.alloc(ranges.length * RANGE_BYTES);
    for (let index = 0; index < ranges.length; index++) {
      const range = ranges[index];
      if (range.end > 0xffff_ffff) return false;
      payload.writeUInt32LE(range.start, index * RANGE_BYTES);
      payload.writeUInt32LE(range.end, index * RANGE_BYTES + 4);
    }
    return this.store.set(
      fingerprint.key,
      JSON_PREVIEW_RANGE_VERSION,
      { size: fingerprint.size, mtimeMs: fingerprint.mtimeMs, recordCount: ranges.length },
      payload,
    );
  }

  async clear(): Promise<void> {
    await this.store.clear();
  }
}
