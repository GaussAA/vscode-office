import type { ParquetEmptyShare } from "@/common/parquetProfileTypes";
import { savePersistedState } from "../../common/persistedState.ts";

/**
 * The empty-share scan cache, keyed by the document's stable cache id.
 *
 * A scan decodes a bounded prefix; re-running it every time the tab is closed would undo the
 * reason it is bounded. The entry is only reused when the file's **size and mtime** still match
 * and the entry is younger than `MAX_AGE_MS`; a changed file, a new algorithm version, a
 * corrupt blob or an expired entry all miss. The shared `savePersistedState` helper keeps the
 * prefix to `PERSIST_MAX_ENTRIES` newest documents, so opening many parquet files cannot grow
 * storage without bound.
 *
 * Only documents with a mtime are cached: an inline/virtual document has no stable fingerprint,
 * and a guessed one would serve numbers for different bytes.
 */
export const PARQUET_SHARES_PREFIX = "parquet-shares:";

/**
 * Bump when the scan semantics or its row cap change. A cached `scanned`/`emptyRatio` describes
 * the run that produced it, so a different cap or a different empty definition invalidates it.
 */
const CACHE_VERSION = 1;
/** A week is longer than a working session and short enough that abandoned entries go away. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface ParquetShareScope {
  /** Stable document identity (`documentCacheId`), not the per-session webview path. */
  key: string;
  /** The open payload's size; part of the fingerprint. */
  size?: number;
  /** The open payload's last-modified time; without it the cache is not used. */
  mtimeMs?: number;
}

interface StoredParquetShares {
  v: number;
  size?: number;
  mtimeMs?: number;
  shares: ParquetEmptyShare[];
  /** Written by `savePersistedState`; used for the TTL and the LRU order. */
  ts?: number;
}

function isShare(value: unknown): value is ParquetEmptyShare {
  if (!value || typeof value !== "object") return false;
  const share = value as Record<string, unknown>;
  return (
    typeof share.name === "string" &&
    typeof share.scanned === "number" &&
    Number.isFinite(share.scanned) &&
    share.scanned >= 0 &&
    typeof share.rowCount === "number" &&
    Number.isFinite(share.rowCount) &&
    share.rowCount >= 0 &&
    typeof share.complete === "boolean" &&
    typeof share.nulls === "number" &&
    Number.isFinite(share.nulls) &&
    share.nulls >= 0 &&
    typeof share.empties === "number" &&
    Number.isFinite(share.empties) &&
    share.empties >= 0 &&
    typeof share.emptyRatio === "number" &&
    Number.isFinite(share.emptyRatio) &&
    share.emptyRatio >= 0 &&
    share.emptyRatio <= 1
  );
}

/** The stored shares for this document and fingerprint, or null after a miss. */
function readValidShares(scope: ParquetShareScope): ParquetEmptyShare[] | null {
  const storageKey = PARQUET_SHARES_PREFIX + scope.key;
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredParquetShares>;
    const fresh = typeof parsed.ts === "number" && Date.now() - parsed.ts <= MAX_AGE_MS;
    const matches =
      parsed.v === CACHE_VERSION &&
      parsed.size === scope.size &&
      parsed.mtimeMs === scope.mtimeMs &&
      fresh;
    if (!matches || !Array.isArray(parsed.shares) || !parsed.shares.every(isShare)) {
      // A stale or corrupt entry is garbage the next scan would overwrite; drop it now so a
      // changed file does not keep a misleading blob in storage.
      localStorage.removeItem(storageKey);
      return null;
    }
    return parsed.shares;
  } catch {
    // Unparseable JSON is not a number for anybody; remove it so it cannot be retried forever.
    try {
      localStorage.removeItem(storageKey);
    } catch {}
    return null;
  }
}

/** The stored shares for this document and fingerprint, or an empty list after a miss. */
export function loadParquetShares(scope: ParquetShareScope | null): ParquetEmptyShare[] {
  if (!scope || scope.mtimeMs === undefined) return [];
  return readValidShares(scope) ?? [];
}

/**
 * Persist the current shares for this document; a no-op without a fingerprint.
 *
 * This is a read-merge-write, not a whole-list overwrite: another tab may have scanned a
 * different column since this tab's last read. The incoming share wins for its own column;
 * every other cached column is kept. The write is still not atomic across tabs — the window is
 * tiny, and a lost same-column update is the documented limit (ADR-0025).
 */
export function saveParquetShares(
  scope: ParquetShareScope | null,
  shares: ParquetEmptyShare[],
): void {
  if (!scope || scope.mtimeMs === undefined || shares.length === 0) return;
  if (!shares.every(isShare)) return;
  const merged = new Map<string, ParquetEmptyShare>();
  for (const share of readValidShares(scope) ?? []) merged.set(share.name, share);
  for (const share of shares) merged.set(share.name, share);
  savePersistedState(PARQUET_SHARES_PREFIX, scope.key, {
    v: CACHE_VERSION,
    size: scope.size,
    mtimeMs: scope.mtimeMs,
    shares: [...merged.values()],
  });
}
