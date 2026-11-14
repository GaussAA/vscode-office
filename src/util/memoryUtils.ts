/**
 * Memory monitoring and optimization utilities for development and debugging.
 *
 * Provides tools to track memory usage, detect leaks, and optimize performance.
 */

export interface MemoryStats {
  /** Current memory usage in bytes */
  usedJSHeapSize: number;
  /** Total allocated heap size in bytes */
  totalJSHeapSize: number;
  /** Maximum heap size limit in bytes */
  jsHeapSizeLimit: number;
  /** Memory usage as percentage of limit */
  usagePercent: number;
}

export interface MemorySnapshot {
  timestamp: number;
  stats: MemoryStats;
  label?: string;
}

/**
 * Memory monitor for tracking and analyzing memory usage.
 *
 * @example
 * ```typescript
 * const monitor = new MemoryMonitor();
 * monitor.takeSnapshot('before-operation');
 * // ... perform operation ...
 * monitor.takeSnapshot('after-operation');
 * const diff = monitor.compare('before-operation', 'after-operation');
 * console.log(`Memory delta: ${(diff / 1024 / 1024).toFixed(2)} MB`);
 * ```
 */
export class MemoryMonitor {
  private snapshots: Map<string, MemorySnapshot> = new Map();
  private isSupported: boolean;

  constructor() {
    // Check if performance.memory is available (Chrome/Edge only)
    this.isSupported = !!(performance as any).memory;
  }

  /**
   * Check if memory monitoring is supported in current environment.
   */
  supported(): boolean {
    return this.isSupported;
  }

  /**
   * Get current memory statistics.
   */
  getStats(): MemoryStats | null {
    if (!this.isSupported) return null;

    const memory = (performance as any).memory;
    return {
      usedJSHeapSize: memory.usedJSHeapSize,
      totalJSHeapSize: memory.totalJSHeapSize,
      jsHeapSizeLimit: memory.jsHeapSizeLimit,
      usagePercent: (memory.usedJSHeapSize / memory.jsHeapSizeLimit) * 100,
    };
  }

  /**
   * Take a named memory snapshot.
   */
  takeSnapshot(label: string): MemorySnapshot | null {
    const stats = this.getStats();

    const snapshot: MemorySnapshot = {
      timestamp: Date.now(),
      stats: stats ?? {
        usedJSHeapSize: 0,
        totalJSHeapSize: 0,
        jsHeapSizeLimit: 0,
        usagePercent: 0,
      },
      label,
    };

    this.snapshots.set(label, snapshot);
    return stats ? snapshot : null;
  }

  /**
   * Get a previously taken snapshot.
   */
  getSnapshot(label: string): MemorySnapshot | undefined {
    return this.snapshots.get(label);
  }

  /**
   * Compare two snapshots and return the memory delta in bytes.
   * Positive = memory increased, negative = memory decreased.
   */
  compare(before: string, after: string): number | null {
    const beforeSnapshot = this.snapshots.get(before);
    const afterSnapshot = this.snapshots.get(after);

    if (!beforeSnapshot || !afterSnapshot) return null;

    return afterSnapshot.stats.usedJSHeapSize - beforeSnapshot.stats.usedJSHeapSize;
  }

  /**
   * Clear all snapshots.
   */
  clearSnapshots(): void {
    this.snapshots.clear();
  }

  /**
   * Get all snapshot labels.
   */
  getLabels(): string[] {
    return Array.from(this.snapshots.keys());
  }

  /**
   * Format bytes to human-readable string.
   */
  static formatBytes(bytes: number): string {
    if (bytes === 0) return "0 B";

    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(Math.abs(bytes)) / Math.log(k));
    const value = bytes / Math.pow(k, i);

    return `${value.toFixed(2)} ${sizes[i]}`;
  }

  /**
   * Log current memory stats to console.
   */
  logStats(label?: string): void {
    const stats = this.getStats();
    if (!stats) {
      console.warn("Memory monitoring not supported in this browser");
      return;
    }

    const prefix = label ? `[${label}] ` : "";
    console.log(`${prefix}Memory Usage:`, {
      used: MemoryMonitor.formatBytes(stats.usedJSHeapSize),
      total: MemoryMonitor.formatBytes(stats.totalJSHeapSize),
      limit: MemoryMonitor.formatBytes(stats.jsHeapSizeLimit),
      usage: `${stats.usagePercent.toFixed(2)}%`,
    });
  }

  /**
   * Log comparison between two snapshots.
   */
  logComparison(before: string, after: string): void {
    const delta = this.compare(before, after);
    if (delta === null) {
      console.warn(`Cannot compare: snapshots '${before}' or '${after}' not found`);
      return;
    }

    const sign = delta >= 0 ? "+" : "";
    console.log(`Memory delta (${before} → ${after}): ${sign}${MemoryMonitor.formatBytes(delta)}`);
  }
}

/**
 * WeakMap-based cache that automatically cleans up when keys are garbage collected.
 *
 * Use this for caching data associated with objects that may be disposed.
 *
 * @example
 * ```typescript
 * const cache = new WeakCache<HTMLElement, ComputedStyle>();
 * const style = cache.getOrCompute(element, () => computeStyle(element));
 * ```
 */
export class WeakCache<K extends object, V> {
  private cache = new WeakMap<K, V>();

  /**
   * Get a cached value or compute and cache it if not present.
   */
  getOrCompute(key: K, compute: () => V): V {
    let value = this.cache.get(key);
    if (value === undefined) {
      value = compute();
      this.cache.set(key, value);
    }
    return value;
  }

  /**
   * Get a cached value.
   */
  get(key: K): V | undefined {
    return this.cache.get(key);
  }

  /**
   * Set a cached value.
   */
  set(key: K, value: V): void {
    this.cache.set(key, value);
  }

  /**
   * Check if a key exists in the cache.
   */
  has(key: K): boolean {
    return this.cache.has(key);
  }

  /**
   * Delete a cached value.
   */
  delete(key: K): boolean {
    return this.cache.delete(key);
  }
}

/**
 * Create a global memory monitor instance (development only).
 */
export const memoryMonitor = process.env.NODE_ENV === "development" ? new MemoryMonitor() : null;
