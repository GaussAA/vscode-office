import type { ParquetColumnScan } from "@/common/parquetProfileTypes";

/**
 * Host-side cache for full single-column scans (ADR-0025).
 *
 * This is the one cache that lives in the extension host rather than a webview, because its
 * value is shared: two tabs of the same document, or reopening a tab in the same VS Code
 * session, must not decode the same 200k-row prefix again. Entries are keyed by the document's
 * stable cache id plus the file fingerprint the host just statted; a changed file is a new key,
 * and the old version is dropped. The cache holds **values**, so it is memory only and lives
 * exactly as long as the VS Code session (or until Clear cache).
 */
/** Bump when the scan's row cap or value handling changes; old answers must not be reused. */
export const SCAN_CACHE_VERSION = 1;
/** Files kept; a file keeps every column scanned in it. */
export const SCAN_CACHE_MAX_FILES = 3;

export interface ParquetScanFingerprint {
  /** `documentCacheId`: scheme + URI. */
  key: string;
  size?: number;
  mtimeMs?: number;
}

interface CachedFile {
  fingerprint: ParquetScanFingerprint;
  columns: Map<string, ParquetColumnScan>;
}

function fileKey(fingerprint: ParquetScanFingerprint): string {
  // NUL cannot appear in a URI or a column name, so it is a safe separator.
  return [
    SCAN_CACHE_VERSION,
    fingerprint.key,
    fingerprint.size ?? "?",
    fingerprint.mtimeMs ?? "?",
  ].join("\u0000");
}

export class ParquetScanCache {
  private readonly files = new Map<string, CachedFile>();
  private readonly pending = new Map<string, Promise<ParquetColumnScan>>();
  private generation = 0;

  constructor(private readonly maxFiles = SCAN_CACHE_MAX_FILES) {}

  /** The cached scan, touching the file's LRU position. */
  get(fingerprint: ParquetScanFingerprint, column: string): ParquetColumnScan | undefined {
    const key = fileKey(fingerprint);
    const file = this.files.get(key);
    if (!file) return undefined;
    this.files.delete(key);
    this.files.set(key, file);
    return file.columns.get(column);
  }

  set(fingerprint: ParquetScanFingerprint, column: string, scan: ParquetColumnScan): void {
    // A changed file supersedes its old version; keeping both would let the same document
    // occupy two of the three file slots.
    for (const [key, file] of this.files) {
      if (file.fingerprint.key === fingerprint.key && key !== fileKey(fingerprint)) {
        this.files.delete(key);
      }
    }
    const key = fileKey(fingerprint);
    let file = this.files.get(key);
    if (file) {
      this.files.delete(key);
      this.files.set(key, file);
    } else {
      file = { fingerprint, columns: new Map() };
      this.files.set(key, file);
      while (this.files.size > this.maxFiles) {
        const oldest = this.files.keys().next().value;
        if (oldest === undefined) break;
        this.files.delete(oldest);
      }
    }
    file.columns.set(column, scan);
  }

  /**
   * A cache hit, an in-flight request for the same column, or one `run` whose result is cached.
   * A rejected run is not cached, and a `clear()` during the run prevents it from landing.
   */
  async scan(
    fingerprint: ParquetScanFingerprint,
    column: string,
    run: () => Promise<ParquetColumnScan>,
  ): Promise<ParquetColumnScan> {
    const cached = this.get(fingerprint, column);
    if (cached) return cached;
    const pendingKey = `${fileKey(fingerprint)}\u0000${column}`;
    const inFlight = this.pending.get(pendingKey);
    if (inFlight) return inFlight;
    const generation = this.generation;
    let promise: Promise<ParquetColumnScan>;
    promise = run()
      .then((scan) => {
        if (this.generation === generation) this.set(fingerprint, column, scan);
        return scan;
      })
      .finally(() => {
        // A clear() replaces the generation; do not delete a newer request's pending entry.
        if (this.generation === generation) this.pending.delete(pendingKey);
      });
    this.pending.set(pendingKey, promise);
    return promise;
  }

  clear(): void {
    this.generation += 1;
    this.files.clear();
    this.pending.clear();
  }

  /** Number of file fingerprints currently cached (files, not columns). */
  get fileCount(): number {
    return this.files.size;
  }
}

/** The extension host's cache; the Clear cache command and every parquet handler share it. */
export const parquetScanCache = new ParquetScanCache();
