/**
 * Persist one webview state blob and keep the restore map bounded.
 *
 * Both the parquet and JSONL viewers remember UI state per document in `localStorage`.
 * The map grew by one key per document and nothing ever removed old entries, so this
 * helper owns the shared write + LRU eviction instead of each viewer carrying its own
 * copy. Storage may be unavailable (private mode, quota); persistence is a convenience,
 * so failures are swallowed.
 */
export const PERSIST_MAX_ENTRIES = 20;

export function savePersistedState<T extends object>(
  prefix: string,
  key: string,
  state: T,
  maxEntries = PERSIST_MAX_ENTRIES,
): void {
  try {
    localStorage.setItem(prefix + key, JSON.stringify({ ...state, ts: Date.now() }));
    evictPersistedState(prefix, maxEntries);
  } catch {
    // storage may be unavailable; state is a convenience, not a requirement
  }
}

/** Keep only the newest `maxEntries` keys under `prefix`, oldest timestamp first. */
function evictPersistedState(prefix: string, maxEntries: number): void {
  const entries: Array<{ key: string; ts: number }> = [];
  for (let index = 0; index < localStorage.length; index++) {
    const storageKey = localStorage.key(index);
    if (!storageKey?.startsWith(prefix)) continue;
    let ts = 0;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) ts = (JSON.parse(raw) as { ts?: number }).ts ?? 0;
    } catch {}
    entries.push({ key: storageKey, ts });
  }
  if (entries.length <= maxEntries) return;
  entries.sort((a, b) => a.ts - b.ts);
  for (const entry of entries.slice(0, entries.length - maxEntries)) {
    localStorage.removeItem(entry.key);
  }
}
