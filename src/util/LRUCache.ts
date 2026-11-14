/**
 * Least Recently Used (LRU) Cache implementation.
 *
 * Automatically evicts the least recently used items when capacity is reached.
 * Supports optional TTL (time-to-live) for automatic expiration.
 *
 * @example
 * ```typescript
 * const cache = new LRUCache<string, number>(100);
 * cache.set('key', 42);
 * const value = cache.get('key'); // 42
 * ```
 */
export class LRUCache<K, V> {
  private readonly capacity: number;
  private readonly ttl: number | undefined;
  private readonly cache: Map<K, CacheEntry<V>>;
  private hits = 0;
  private misses = 0;

  constructor(capacity: number, ttl?: number) {
    if (capacity <= 0) {
      throw new Error("Cache capacity must be positive");
    }
    this.capacity = capacity;
    this.ttl = ttl;
    this.cache = new Map();
  }

  /**
   * Get a value from the cache.
   * Updates the access time and moves the entry to the end (most recently used).
   *
   * @returns The cached value, or undefined if not found or expired
   */
  get(key: K): V | undefined {
    const entry = this.cache.get(key);

    if (!entry) {
      this.misses++;
      return undefined;
    }

    // Check if expired
    if (this.ttl && Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key);
      this.misses++;
      return undefined;
    }

    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, { ...entry, timestamp: Date.now() });
    this.hits++;
    return entry.value;
  }

  /**
   * Set a value in the cache.
   * If capacity is reached, evicts the least recently used item.
   */
  set(key: K, value: V): void {
    // Remove if exists (to update position)
    this.cache.delete(key);

    // Evict oldest if at capacity
    if (this.cache.size >= this.capacity) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }

    // Add new entry
    this.cache.set(key, {
      value,
      timestamp: Date.now(),
    });
  }

  /**
   * Check if a key exists in the cache (without updating access time).
   */
  has(key: K): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;

    // Check if expired
    if (this.ttl && Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Delete a specific key from the cache.
   */
  delete(key: K): boolean {
    return this.cache.delete(key);
  }

  /**
   * Clear all entries from the cache.
   */
  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Get the current number of entries in the cache.
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * Get the cache hit rate (hits / total accesses).
   */
  hitRate(): number {
    const total = this.hits + this.misses;
    return total === 0 ? 0 : this.hits / total;
  }

  /**
   * Get cache statistics.
   */
  stats() {
    return {
      hits: this.hits,
      misses: this.misses,
      hitRate: this.hitRate(),
      size: this.size(),
      capacity: this.capacity,
    };
  }

  /**
   * Remove expired entries (if TTL is set).
   *
   * @returns Number of entries removed
   */
  prune(): number {
    if (!this.ttl) return 0;

    const now = Date.now();
    let removed = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.ttl) {
        this.cache.delete(key);
        removed++;
      }
    }

    return removed;
  }
}

interface CacheEntry<V> {
  value: V;
  timestamp: number;
}
