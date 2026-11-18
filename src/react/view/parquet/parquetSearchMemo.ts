import type { ParquetHitSet } from "./parquetHitSet";

/** One finished whole-file search: the immutable hit list and whether it stopped at the cap. */
export interface ParquetSearchMemoEntry {
  hitSet: ParquetHitSet;
  capped: boolean;
}

/** How many distinct queries one document keeps; a hit set is bounded by `SEARCH_MAX_ROWS`. */
export const SEARCH_MEMO_QUERIES = 3;

/**
 * Per-document memo of whole-file search results (ADR-0025).
 *
 * A search is one pass over every value, so re-running the same normalized query after a detour
 * should not pay for it again. The memo holds the immutable `ParquetHitSet`; its rows are capped
 * at `SEARCH_MAX_ROWS`, so memory is bounded by the result cap, not by the file size. Keys are
 * normalized queries. The viewer clears the memo when the document changes or Clear cache runs,
 * but keeps it while the user edits the query.
 */
export class ParquetSearchMemo {
  private readonly entries = new Map<string, ParquetSearchMemoEntry>();

  constructor(private readonly maxQueries = SEARCH_MEMO_QUERIES) {}

  /** The result for `query`, touching its LRU position. */
  get(query: string): ParquetSearchMemoEntry | undefined {
    const entry = this.entries.get(query);
    if (!entry) return undefined;
    this.entries.delete(query);
    this.entries.set(query, entry);
    return entry;
  }

  set(query: string, entry: ParquetSearchMemoEntry): void {
    this.entries.delete(query);
    this.entries.set(query, entry);
    while (this.entries.size > this.maxQueries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}
