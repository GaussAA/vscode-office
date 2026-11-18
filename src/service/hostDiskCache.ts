/**
 * A small file-backed cache owned by the extension host.
 *
 * The parquet caches live in the webview's `localStorage` (ADR-0025), but the JSONL line
 * index is built and held by the host and can be tens of megabytes — too large for the
 * webview quota. This store is the host-side equivalent: one metadata file plus one binary
 * payload per entry, keyed by a hash of the caller's cache key. It deliberately knows
 * nothing about JSONL; callers pass a version and an opaque metadata object, and only
 * aggregates/offsets may be stored here (values stay in memory).
 *
 * The store enforces a per-entry size, a total payload budget, an entry-count LRU and a
 * TTL. Writes are atomic (temp file + rename), and corrupt or version-stale entries are
 * removed on read instead of being returned.
 */
import { createHash } from "node:crypto";
import { promises as fsp } from "node:fs";
import path from "node:path";

export interface HostDiskCacheOptions {
  /** Refuse an entry whose payload is larger than this many bytes. */
  maxEntryBytes: number;
  /** Evict least-recently-used entries until the total payload fits. */
  maxTotalBytes: number;
  maxEntries: number;
  ttlMs: number;
  /** Injected for tests; production uses the wall clock. */
  now?: () => number;
}

export interface HostDiskCacheMeta {
  key: string;
  version: number;
  createdAt: number;
  lastUsedAt: number;
  /** Payload bytes; the metadata file itself is not counted. */
  bytes: number;
  /** Caller-owned validation data (size, mtimeMs, lineCount, ...). */
  data: Record<string, unknown>;
}

export interface HostDiskCacheEntry {
  meta: HostDiskCacheMeta;
  payload: Buffer;
}

interface ScannedEntry {
  hash: string;
  meta: HostDiskCacheMeta;
}

export class HostDiskCache {
  private readonly now: () => number;

  constructor(
    private readonly root: string,
    private readonly options: HostDiskCacheOptions,
  ) {
    this.now = options.now ?? Date.now;
  }

  async get(key: string, version: number): Promise<HostDiskCacheEntry | null> {
    const hash = this.hash(key);
    const meta = await this.readMeta(hash);
    if (!meta || meta.key !== key || meta.version !== version) {
      await this.remove(hash);
      return null;
    }
    if (this.expired(meta)) {
      await this.remove(hash);
      return null;
    }
    const payload = await this.readPayload(hash);
    if (!payload || payload.byteLength !== meta.bytes) {
      await this.remove(hash);
      return null;
    }
    // Refresh the LRU order, but never let a metadata write failure hide a valid payload.
    meta.lastUsedAt = this.now();
    await this.writeMeta(hash, meta).catch(() => undefined);
    return { meta, payload };
  }

  async set(
    key: string,
    version: number,
    data: Record<string, unknown>,
    payload: Uint8Array,
  ): Promise<boolean> {
    if (
      payload.byteLength > this.options.maxEntryBytes ||
      payload.byteLength > this.options.maxTotalBytes
    ) {
      return false;
    }
    await fsp.mkdir(this.root, { recursive: true });
    const hash = this.hash(key);
    await this.prune(hash, payload.byteLength);
    const now = this.now();
    const meta: HostDiskCacheMeta = {
      key,
      version,
      createdAt: now,
      lastUsedAt: now,
      bytes: payload.byteLength,
      data,
    };
    await this.writeAtomic(this.payloadPath(hash), Buffer.from(payload));
    // The metadata is written last: a crash between the two renames leaves an old/missing
    // metadata file, which `get` treats as a miss and removes.
    await this.writeAtomic(this.metaPath(hash), JSON.stringify(meta));
    return true;
  }

  async delete(key: string): Promise<void> {
    await this.remove(this.hash(key));
  }

  async clear(): Promise<void> {
    await fsp.rm(this.root, { recursive: true, force: true });
    await fsp.mkdir(this.root, { recursive: true });
  }

  private hash(key: string): string {
    return createHash("sha256").update(key).digest("hex");
  }

  private metaPath(hash: string): string {
    return path.join(this.root, `${hash}.json`);
  }

  private payloadPath(hash: string): string {
    return path.join(this.root, `${hash}.bin`);
  }

  private expired(meta: HostDiskCacheMeta): boolean {
    return this.now() - meta.createdAt > this.options.ttlMs;
  }

  private async remove(hash: string): Promise<void> {
    await Promise.all([
      fsp.rm(this.metaPath(hash), { force: true }),
      fsp.rm(this.payloadPath(hash), { force: true }),
    ]);
  }

  private async readMeta(hash: string): Promise<HostDiskCacheMeta | null> {
    try {
      const raw = await fsp.readFile(this.metaPath(hash), "utf8");
      const parsed = JSON.parse(raw) as Partial<HostDiskCacheMeta>;
      if (
        typeof parsed.key !== "string" ||
        typeof parsed.version !== "number" ||
        typeof parsed.createdAt !== "number" ||
        typeof parsed.lastUsedAt !== "number" ||
        typeof parsed.bytes !== "number" ||
        !parsed.data ||
        typeof parsed.data !== "object" ||
        Array.isArray(parsed.data)
      ) {
        return null;
      }
      return parsed as HostDiskCacheMeta;
    } catch {
      return null;
    }
  }

  private async readPayload(hash: string): Promise<Buffer | null> {
    try {
      return await fsp.readFile(this.payloadPath(hash));
    } catch {
      return null;
    }
  }

  private async writeMeta(hash: string, meta: HostDiskCacheMeta): Promise<void> {
    await this.writeAtomic(this.metaPath(hash), JSON.stringify(meta));
  }

  private async writeAtomic(target: string, data: string | Buffer): Promise<void> {
    const temporary = `${target}.${process.pid}.${this.now()}.${Math.random()
      .toString(36)
      .slice(2)}.tmp`;
    try {
      await fsp.writeFile(temporary, data);
      await fsp.rename(temporary, target);
    } catch (cause) {
      await fsp.rm(temporary, { force: true }).catch(() => undefined);
      throw cause;
    }
  }

  /**
   * Make room for `incomingBytes` under the same key. The old entry for `incomingHash` is
   * excluded because the following write replaces it. Expired entries are removed first;
   * then the least-recently-used entries until both the count and byte budgets fit.
   */
  private async prune(incomingHash: string, incomingBytes: number): Promise<void> {
    const entries = (await this.scan()).filter((entry) => entry.hash !== incomingHash);
    let total = 0;
    const live: ScannedEntry[] = [];
    for (const entry of entries) {
      if (this.expired(entry.meta)) {
        await this.remove(entry.hash);
        continue;
      }
      live.push(entry);
      total += entry.meta.bytes;
    }
    live.sort((left, right) => left.meta.lastUsedAt - right.meta.lastUsedAt);
    while (
      live.length > 0 &&
      (live.length >= this.options.maxEntries || total + incomingBytes > this.options.maxTotalBytes)
    ) {
      const oldest = live.shift();
      if (!oldest) break;
      await this.remove(oldest.hash);
      total -= oldest.meta.bytes;
    }
  }

  private async scan(): Promise<ScannedEntry[]> {
    let names: string[];
    try {
      names = await fsp.readdir(this.root);
    } catch {
      return [];
    }
    const entries: ScannedEntry[] = [];
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      const hash = name.slice(0, -".json".length);
      const meta = await this.readMeta(hash);
      if (meta) entries.push({ hash, meta });
    }
    return entries;
  }
}
