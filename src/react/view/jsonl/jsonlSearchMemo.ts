/**
 * Per-webview memo for completed JSONL searches.
 *
 * The host still owns the scan; this only remembers the last few completed result sets so
 * retyping or revisiting the same query does not start another full-file pass. The entries
 * contain user data, so the memo never leaves the webview and dies with the tab. The key is
 * case-folded because the host search is case-insensitive.
 */
import type { JsonlEntrySummary } from "@/common/jsonlTypes";

export interface JsonlSearchMeta {
  matches: number;
  scanned: number;
  total: number;
  done: boolean;
  capped: boolean;
}

export interface JsonlSearchSnapshot {
  entries: JsonlEntrySummary[];
  meta: JsonlSearchMeta;
}

export const JSONL_SEARCH_MEMO_ENTRIES = 3;

export function jsonlSearchMemoKey(query: string): string {
  return query.trim().toLocaleLowerCase();
}

export class JsonlSearchMemo {
  private readonly snapshots = new Map<string, JsonlSearchSnapshot>();

  constructor(private readonly maxEntries = JSONL_SEARCH_MEMO_ENTRIES) {}

  get(query: string): JsonlSearchSnapshot | null {
    const key = jsonlSearchMemoKey(query);
    return this.snapshots.get(key) ?? null;
  }

  set(query: string, snapshot: JsonlSearchSnapshot): void {
    const key = jsonlSearchMemoKey(query);
    // Re-insert so the newest query is last; Map order is our LRU order.
    this.snapshots.delete(key);
    this.snapshots.set(key, snapshot);
    while (this.snapshots.size > this.maxEntries) {
      const oldest = this.snapshots.keys().next().value;
      if (oldest === undefined) break;
      this.snapshots.delete(oldest);
    }
  }

  clear(): void {
    this.snapshots.clear();
  }
}
