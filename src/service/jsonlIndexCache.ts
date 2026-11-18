/**
 * Disk cache for the JSONL line index.
 *
 * The index is only line-start offsets, 8 bytes per line; it contains no user values, which
 * is why it is allowed to live on disk (ADR-0026). On a hit the host can construct the
 * `JsonlFile` without the full sequential scan that `buildJsonlIndexFrom` otherwise does.
 *
 * The fingerprint is validated against the metadata, so a changed size or mtime is a miss
 * even before the caller compares the decoded offsets. The payload is little-endian
 * `uint64` offsets, matching the 8-bytes-per-line budget; a corrupt length or a
 * non-monotonic offset is treated as a miss and removed.
 */
import type { FileFingerprint } from "@/common/fileFingerprint";
import { HostDiskCache } from "@/service/hostDiskCache";
import type { JsonlIndex } from "@/service/jsonlDocument";

export const JSONL_INDEX_VERSION = 1;
export const JSONL_INDEX_MAX_BYTES = 16 * 1024 * 1024;
export const JSONL_INDEX_MAX_TOTAL_BYTES = 64 * 1024 * 1024;
export const JSONL_INDEX_MAX_FILES = 5;
export const JSONL_INDEX_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const OFFSET_BYTES = 8;

interface StoredIndexMeta {
  size?: unknown;
  mtimeMs?: unknown;
  lineCount?: unknown;
}

export class JsonlIndexCache {
  private readonly store: HostDiskCache;

  constructor(root: string, now?: () => number) {
    this.store = new HostDiskCache(root, {
      maxEntryBytes: JSONL_INDEX_MAX_BYTES,
      maxTotalBytes: JSONL_INDEX_MAX_TOTAL_BYTES,
      maxEntries: JSONL_INDEX_MAX_FILES,
      ttlMs: JSONL_INDEX_TTL_MS,
      now,
    });
  }

  async get(fingerprint: FileFingerprint): Promise<JsonlIndex | null> {
    const entry = await this.store.get(fingerprint.key, JSONL_INDEX_VERSION);
    if (!entry) return null;
    const meta = entry.meta.data as StoredIndexMeta;
    if (
      meta.size !== fingerprint.size ||
      meta.mtimeMs !== fingerprint.mtimeMs ||
      typeof meta.lineCount !== "number" ||
      !Number.isInteger(meta.lineCount) ||
      meta.lineCount < 0 ||
      entry.payload.byteLength !== meta.lineCount * OFFSET_BYTES
    ) {
      await this.store.delete(fingerprint.key);
      return null;
    }
    const lineCount = meta.lineCount;
    const offsets: number[] = [];
    const view = new DataView(
      entry.payload.buffer,
      entry.payload.byteOffset,
      entry.payload.byteLength,
    );
    for (let line = 0; line < lineCount; line++) {
      const value = view.getBigUint64(line * OFFSET_BYTES, true);
      if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
        await this.store.delete(fingerprint.key);
        return null;
      }
      const offset = Number(value);
      if (
        offset < 0 ||
        offset > fingerprint.size ||
        (line === 0 ? offset !== 0 : offset <= offsets[line - 1])
      ) {
        await this.store.delete(fingerprint.key);
        return null;
      }
      offsets[line] = offset;
    }
    return { offsets, lineCount };
  }

  async set(fingerprint: FileFingerprint, index: JsonlIndex): Promise<boolean> {
    if (index.lineCount !== index.offsets.length) return false;
    const payload = Buffer.alloc(index.lineCount * OFFSET_BYTES);
    for (let line = 0; line < index.lineCount; line++) {
      const offset = index.offsets[line];
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > fingerprint.size) return false;
      payload.writeBigUInt64LE(BigInt(offset), line * OFFSET_BYTES);
    }
    return this.store.set(
      fingerprint.key,
      JSONL_INDEX_VERSION,
      { size: fingerprint.size, mtimeMs: fingerprint.mtimeMs, lineCount: index.lineCount },
      payload,
    );
  }

  async clear(): Promise<void> {
    await this.store.clear();
  }
}
