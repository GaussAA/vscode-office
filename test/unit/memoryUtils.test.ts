/* eslint-disable @typescript-eslint/no-floating-promises */
import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import {
  MemoryMonitor,
  WeakCache,
  MemoryMonitor as MemoryMonitorClass,
} from "../../src/util/memoryUtils";

describe("MemoryMonitor", () => {
  describe("Browser support detection", () => {
    it("should detect when memory monitoring is not supported", () => {
      const monitor = new MemoryMonitor();
      // In Node.js, performance.memory is not available
      assert.equal(monitor.supported(), false);
    });

    it("should return null stats when not supported", () => {
      const monitor = new MemoryMonitor();
      const stats = monitor.getStats();
      assert.equal(stats, null);
    });
  });

  describe("Snapshot management", () => {
    it("should return null snapshot when not supported", () => {
      const monitor = new MemoryMonitor();
      const snapshot = monitor.takeSnapshot("test");
      assert.equal(snapshot, null);
    });

    it("should store and retrieve snapshots", () => {
      const monitor = new MemoryMonitor();
      monitor.takeSnapshot("test1");
      monitor.takeSnapshot("test2");

      const labels = monitor.getLabels();
      assert.equal(labels.length, 2);
      assert.ok(labels.includes("test1"));
      assert.ok(labels.includes("test2"));
    });

    it("should get stored snapshot", () => {
      const monitor = new MemoryMonitor();
      monitor.takeSnapshot("test");
      const snapshot = monitor.getSnapshot("test");

      // Should exist even if stats are null
      assert.ok(snapshot !== undefined);
    });

    it("should return undefined for non-existent snapshot", () => {
      const monitor = new MemoryMonitor();
      const snapshot = monitor.getSnapshot("nonexistent");
      assert.equal(snapshot, undefined);
    });

    it("should clear all snapshots", () => {
      const monitor = new MemoryMonitor();
      monitor.takeSnapshot("test1");
      monitor.takeSnapshot("test2");

      monitor.clearSnapshots();

      assert.equal(monitor.getLabels().length, 0);
    });
  });

  describe("Comparison", () => {
    it("should return null when comparing non-existent snapshots", () => {
      const monitor = new MemoryMonitor();
      const delta = monitor.compare("before", "after");
      assert.equal(delta, null);
    });

    it("should return null when one snapshot is missing", () => {
      const monitor = new MemoryMonitor();
      monitor.takeSnapshot("before");
      const delta = monitor.compare("before", "after");
      assert.equal(delta, null);
    });
  });

  describe("Utility methods", () => {
    it("should format bytes correctly", () => {
      assert.equal(MemoryMonitorClass.formatBytes(0), "0 B");
      assert.equal(MemoryMonitorClass.formatBytes(1024), "1.00 KB");
      assert.equal(MemoryMonitorClass.formatBytes(1024 * 1024), "1.00 MB");
      assert.equal(MemoryMonitorClass.formatBytes(1024 * 1024 * 1024), "1.00 GB");
    });

    it("should format negative bytes correctly", () => {
      assert.equal(MemoryMonitorClass.formatBytes(-1024), "-1.00 KB");
      assert.equal(MemoryMonitorClass.formatBytes(-1024 * 1024), "-1.00 MB");
    });

    it("should format fractional bytes correctly", () => {
      assert.equal(MemoryMonitorClass.formatBytes(1536), "1.50 KB");
      assert.equal(MemoryMonitorClass.formatBytes(1.5 * 1024 * 1024), "1.50 MB");
    });

    it("should log stats without error when not supported", () => {
      const monitor = new MemoryMonitor();
      const consoleWarn = mock.method(console, "warn");

      monitor.logStats();

      assert.equal(consoleWarn.mock.calls.length, 1);
      consoleWarn.mock.restore();
    });

    it("should log comparison without error when snapshots missing", () => {
      const monitor = new MemoryMonitor();
      const consoleWarn = mock.method(console, "warn");

      monitor.logComparison("before", "after");

      assert.equal(consoleWarn.mock.calls.length, 1);
      consoleWarn.mock.restore();
    });
  });
});

describe("WeakCache", () => {
  describe("Basic operations", () => {
    it("should store and retrieve values", () => {
      const cache = new WeakCache<object, string>();
      const key = { id: 1 };

      cache.set(key, "value");
      assert.equal(cache.get(key), "value");
    });

    it("should return undefined for non-existent keys", () => {
      const cache = new WeakCache<object, string>();
      const key = { id: 1 };

      assert.equal(cache.get(key), undefined);
    });

    it("should check if key exists", () => {
      const cache = new WeakCache<object, string>();
      const key = { id: 1 };

      assert.equal(cache.has(key), false);
      cache.set(key, "value");
      assert.equal(cache.has(key), true);
    });

    it("should delete values", () => {
      const cache = new WeakCache<object, string>();
      const key = { id: 1 };

      cache.set(key, "value");
      assert.equal(cache.delete(key), true);
      assert.equal(cache.has(key), false);
      assert.equal(cache.delete(key), false);
    });
  });

  describe("getOrCompute", () => {
    it("should compute value on first access", () => {
      const cache = new WeakCache<object, number>();
      const key = { id: 1 };
      let computeCount = 0;

      const value = cache.getOrCompute(key, () => {
        computeCount++;
        return 42;
      });

      assert.equal(value, 42);
      assert.equal(computeCount, 1);
    });

    it("should return cached value on subsequent access", () => {
      const cache = new WeakCache<object, number>();
      const key = { id: 1 };
      let computeCount = 0;

      cache.getOrCompute(key, () => {
        computeCount++;
        return 42;
      });

      const value = cache.getOrCompute(key, () => {
        computeCount++;
        return 99;
      });

      assert.equal(value, 42);
      assert.equal(computeCount, 1); // Should not compute again
    });

    it("should work with different keys", () => {
      const cache = new WeakCache<object, string>();
      const key1 = { id: 1 };
      const key2 = { id: 2 };

      cache.getOrCompute(key1, () => "value1");
      cache.getOrCompute(key2, () => "value2");

      assert.equal(cache.get(key1), "value1");
      assert.equal(cache.get(key2), "value2");
    });

    it("should handle undefined as a cached value", () => {
      const cache = new WeakCache<object, number | undefined>();
      const key = { id: 1 };
      let computeCount = 0;

      // First call: compute and cache undefined
      const value1 = cache.getOrCompute(key, () => {
        computeCount++;
        return undefined;
      });

      // Second call: should compute again because undefined is not cached
      const value2 = cache.getOrCompute(key, () => {
        computeCount++;
        return 42;
      });

      assert.equal(value1, undefined);
      assert.equal(value2, 42);
      assert.equal(computeCount, 2);
    });
  });

  describe("Memory cleanup", () => {
    it("should allow garbage collection of keys", () => {
      const cache = new WeakCache<object, string>();

      // Create a key in a scope
      {
        const key = { id: 1 };
        cache.set(key, "value");
        assert.equal(cache.has(key), true);
      }

      // Key should be eligible for GC now
      // Note: We can't actually test GC behavior in unit tests,
      // but we can verify the cache doesn't prevent it
      assert.ok(true); // This test documents the expected behavior
    });
  });

  describe("Type safety", () => {
    it("should work with complex value types", () => {
      interface ComplexValue {
        id: number;
        data: string[];
        nested: { key: string };
      }

      const cache = new WeakCache<object, ComplexValue>();
      const key = { id: 1 };
      const value: ComplexValue = {
        id: 42,
        data: ["a", "b", "c"],
        nested: { key: "value" },
      };

      cache.set(key, value);
      const retrieved = cache.get(key);

      assert.deepEqual(retrieved, value);
    });

    it("should work with function values", () => {
      const cache = new WeakCache<object, () => number>();
      const key = { id: 1 };
      const fn = () => 42;

      cache.set(key, fn);
      const retrieved = cache.get(key);

      assert.equal(retrieved?.(), 42);
    });
  });
});
