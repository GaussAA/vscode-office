import { LRUCache } from "../../../util/LRUCache";

/**
 * Cell formatting cache for Parquet viewer.
 *
 * Caches formatted cell values to avoid redundant formatting operations.
 * Uses a combination of row index, column name, and value hash as the cache key.
 */
export class ParquetCellCache {
  private readonly formatCache: LRUCache<string, string>;

  constructor(capacity: number = 1000) {
    // TTL of 5 minutes - formatted values don't change but we don't want
    // to hold onto them indefinitely as the user navigates
    this.formatCache = new LRUCache<string, string>(capacity, 5 * 60 * 1000);
  }

  /**
   * Generate cache key from cell coordinates and value.
   */
  private getCacheKey(row: number, column: string, value: unknown): string {
    // Use a simple hash for the value to keep keys short
    const valueHash = this.hashValue(value);
    return `${row}:${column}:${valueHash}`;
  }

  /**
   * Simple hash function for cache keys.
   */
  private hashValue(value: unknown): string {
    const str = JSON.stringify(value);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString(36);
  }

  /**
   * Get a formatted value from the cache.
   */
  getFormatted(row: number, column: string, value: unknown): string | undefined {
    const key = this.getCacheKey(row, column, value);
    return this.formatCache.get(key);
  }

  /**
   * Store a formatted value in the cache.
   */
  setFormatted(row: number, column: string, value: unknown, formatted: string): void {
    const key = this.getCacheKey(row, column, value);
    this.formatCache.set(key, formatted);
  }

  /**
   * Clear all cached values.
   */
  clear(): void {
    this.formatCache.clear();
  }

  /**
   * Get cache statistics.
   */
  stats() {
    return this.formatCache.stats();
  }

  /**
   * Remove expired entries.
   */
  prune(): number {
    return this.formatCache.prune();
  }
}
