/**
 * Per-document webview state with a version and a TTL.
 *
 * `savePersistedState` already bounds the number of entries; this wrapper adds the two
 * missing pieces shared by persisted viewer state: an older entry can be migrated by reading
 * its pre-version shape once, and an entry that is too old is dropped instead of restored
 * forever. The stored record is `{ v, data, ts }`; `ts` is written by `savePersistedState`
 * and drives both the TTL and the LRU order.
 */
import { savePersistedState } from "./persistedState.ts";

export interface VersionedStateOptions<T> {
  version: number;
  maxAgeMs: number;
  /** Validate the `data` field of the current version. */
  parse: (data: unknown) => T | null;
  /** Validate a pre-version entry: the whole stored object, not a `data` wrapper. */
  parseLegacy?: (stored: unknown) => T | null;
}

interface StoredRecord {
  v?: unknown;
  ts?: unknown;
  data?: unknown;
}

/** Remove one stored entry; a storage failure is not the caller's problem. */
function remove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {}
}

export function loadVersionedState<T>(
  prefix: string,
  key: string,
  options: VersionedStateOptions<T>,
): T | null {
  const storageKey = prefix + key;
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      remove(storageKey);
      return null;
    }
    const record = parsed as StoredRecord;
    if (record.v === options.version) {
      const fresh = typeof record.ts === "number" && Date.now() - record.ts <= options.maxAgeMs;
      if (!fresh) {
        remove(storageKey);
        return null;
      }
      const value = options.parse(record.data);
      if (value === null) remove(storageKey);
      return value;
    }
    // A future version is not a legacy shape; only a record without `v` can migrate.
    if (record.v !== undefined) {
      remove(storageKey);
      return null;
    }
    if (typeof record.ts === "number" && Date.now() - record.ts > options.maxAgeMs) {
      remove(storageKey);
      return null;
    }
    const legacy = options.parseLegacy?.(record) ?? options.parse(record);
    if (legacy === null) {
      remove(storageKey);
      return null;
    }
    saveVersionedState(prefix, key, options.version, legacy);
    return legacy;
  } catch {
    remove(storageKey);
    return null;
  }
}

export function saveVersionedState<T>(
  prefix: string,
  key: string,
  version: number,
  state: T,
): void {
  savePersistedState(prefix, key, { v: version, data: state });
}

/** Remove every document entry under `prefix`; used by the unified Clear command. */
export function clearPersistedPrefix(prefix: string): void {
  try {
    const keys: string[] = [];
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (key?.startsWith(prefix)) keys.push(key);
    }
    for (const key of keys) localStorage.removeItem(key);
  } catch {}
}
