/**
 * Host-side registry for the unified "Clear Data Viewer Caches" command.
 *
 * Each viewer owns its own caches (parquet's host scan cache, JSONL's disk index, the
 * webview-local layouts and memos), so the command must not know how to clear any of them.
 * Providers register a clearer at construction; the command awaits every registered clearer
 * and keeps going if one fails, so a broken viewer cannot strand the others.
 */
export type DataViewerCacheClearer = () => void | Promise<void>;

const clearers = new Set<DataViewerCacheClearer>();

export function registerDataViewerCacheClearer(clearer: DataViewerCacheClearer): {
  dispose(): void;
} {
  clearers.add(clearer);
  return { dispose: () => clearers.delete(clearer) };
}

export async function clearDataViewerCaches(): Promise<void> {
  for (const clearer of clearers) {
    try {
      await clearer();
    } catch {
      // One viewer's failure must not leave the others' caches behind.
    }
  }
}

/** Test hook: the registry is a module singleton, like the providers in a real activation. */
export function resetDataViewerCacheClearers(): void {
  clearers.clear();
}
