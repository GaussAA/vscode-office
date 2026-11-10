import { savePersistedState } from "../../common/persistedState.ts";

/**
 * Where this document was left when its webview went away.
 *
 * Persisted per document, in `localStorage`, keyed by the document's path: webviews of one view
 * type share a single origin, so an unkeyed entry would be overwritten by whichever parquet file
 * was open last. The JSONL viewer does the same thing with its `cacheId`.
 *
 * The stored number is a **row**, not a page: a page is one screenful, so its size depends on the
 * window and a stored page number would land on a different row next time.
 */
const PERSIST_PREFIX = "parquet-state:";

export function loadPersistedRow(key: string | undefined): number {
  if (!key) return 0;
  try {
    const raw = localStorage.getItem(PERSIST_PREFIX + key);
    if (!raw) return 0;
    // `row` since 6.4.1. Older entries (only `page`) are ignored rather than misread as rows.
    const parsed = JSON.parse(raw) as { row?: number };
    return typeof parsed.row === "number" && parsed.row >= 0 ? parsed.row : 0;
  } catch {
    return 0;
  }
}

export function savePersistedRow(key: string | undefined, row: number): void {
  if (!key) return;
  savePersistedState(PERSIST_PREFIX, key, { row });
}
