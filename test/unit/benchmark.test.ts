import { describe, it } from "node:test";
import assert from "node:assert";
import { performance } from "node:perf_hooks";

/**
 * Performance benchmarks for key operations.
 * These tests establish baseline performance metrics and ensure
 * optimizations don't regress over time.
 */

void describe("Performance benchmarks", () => {
  void describe("Data processing", () => {
    void it("should process 10k rows in < 100ms", () => {
      const start = performance.now();

      // Simulate processing 10k rows
      const rows = Array.from({ length: 10000 }, (_, i) => ({
        id: i,
        value: `value-${i}`,
        timestamp: Date.now(),
      }));

      // Simple processing
      const processed = rows.map((row) => ({
        ...row,
        processed: true,
      }));

      const end = performance.now();
      const duration = end - start;

      assert.strictEqual(processed.length, 10000);
      assert.ok(duration < 100, `Expected < 100ms, got ${duration.toFixed(2)}ms`);
    });

    void it("should filter 100k rows in < 200ms", () => {
      const start = performance.now();

      const rows = Array.from({ length: 100000 }, (_, i) => ({
        id: i,
        value: i % 2 === 0 ? "even" : "odd",
      }));

      const filtered = rows.filter((row) => row.value === "even");

      const end = performance.now();
      const duration = end - start;

      assert.strictEqual(filtered.length, 50000);
      assert.ok(duration < 200, `Expected < 200ms, got ${duration.toFixed(2)}ms`);
    });
  });

  void describe("Object creation", () => {
    void it("should create 1k objects in < 10ms", () => {
      const start = performance.now();

      const objects = Array.from({ length: 1000 }, (_, i) => ({
        id: i,
        name: `item-${i}`,
        data: { nested: true },
      }));

      const end = performance.now();
      const duration = end - start;

      assert.strictEqual(objects.length, 1000);
      assert.ok(duration < 10, `Expected < 10ms, got ${duration.toFixed(2)}ms`);
    });
  });

  void describe("String operations", () => {
    void it("should concatenate 10k strings in < 50ms", () => {
      const start = performance.now();

      const strings = Array.from({ length: 10000 }, (_, i) => `string-${i}`);
      const result = strings.join(",");

      const end = performance.now();
      const duration = end - start;

      assert.strictEqual(result.split(",").length, 10000);
      assert.ok(duration < 50, `Expected < 50ms, got ${duration.toFixed(2)}ms`);
    });

    void it("should search in 10k strings in < 20ms", () => {
      const strings = Array.from({ length: 10000 }, (_, i) => `item-${i}`);
      const needle = "item-5000";

      const start = performance.now();

      const found = strings.some((str) => str === needle);

      const end = performance.now();
      const duration = end - start;

      assert.strictEqual(found, true);
      assert.ok(duration < 20, `Expected < 20ms, got ${duration.toFixed(2)}ms`);
    });
  });

  void describe("Array operations", () => {
    void it("should slice large array in < 5ms", () => {
      const array = Array.from({ length: 100000 }, (_, i) => i);

      const start = performance.now();

      const slice = array.slice(5000, 5100);

      const end = performance.now();
      const duration = end - start;

      assert.strictEqual(slice.length, 100);
      assert.ok(duration < 5, `Expected < 5ms, got ${duration.toFixed(2)}ms`);
    });

    void it("should reduce 10k numbers in < 10ms", () => {
      const numbers = Array.from({ length: 10000 }, (_, i) => i);

      const start = performance.now();

      const sum = numbers.reduce((acc, num) => acc + num, 0);

      const end = performance.now();
      const duration = end - start;

      assert.strictEqual(sum, 49995000); // sum of 0..9999
      assert.ok(duration < 10, `Expected < 10ms, got ${duration.toFixed(2)}ms`);
    });
  });

  void describe("Sorting", () => {
    void it("should sort 1k numbers in < 10ms", () => {
      const numbers = Array.from({ length: 1000 }, () => Math.random() * 1000);

      const start = performance.now();

      const sorted = [...numbers].sort((a, b) => a - b);

      const end = performance.now();
      const duration = end - start;

      assert.ok(sorted[0] <= sorted[sorted.length - 1]);
      assert.ok(duration < 10, `Expected < 10ms, got ${duration.toFixed(2)}ms`);
    });

    void it("should sort 10k strings in < 50ms", () => {
      const strings = Array.from({ length: 10000 }, (_, i) => `item-${Math.random()}`);

      const start = performance.now();

      const sorted = [...strings].sort();

      const end = performance.now();
      const duration = end - start;

      assert.strictEqual(sorted.length, 10000);
      assert.ok(duration < 50, `Expected < 50ms, got ${duration.toFixed(2)}ms`);
    });
  });

  void describe("Memory operations", () => {
    void it("should handle large object without memory explosion", () => {
      const start = performance.now();

      // Create a large nested structure
      const largeObject: Record<string, unknown> = {};
      for (let i = 0; i < 1000; i++) {
        largeObject[`key-${i}`] = {
          id: i,
          data: Array.from({ length: 10 }, (_, j) => j),
        };
      }

      const end = performance.now();
      const duration = end - start;

      assert.strictEqual(Object.keys(largeObject).length, 1000);
      assert.ok(duration < 50, `Expected < 50ms, got ${duration.toFixed(2)}ms`);
    });
  });

  void describe("JSON operations", () => {
    void it("should parse large JSON in < 100ms", () => {
      const data = {
        items: Array.from({ length: 1000 }, (_, i) => ({
          id: i,
          name: `item-${i}`,
          values: [1, 2, 3, 4, 5],
        })),
      };

      const json = JSON.stringify(data);

      const start = performance.now();

      const parsed = JSON.parse(json);

      const end = performance.now();
      const duration = end - start;

      assert.strictEqual(parsed.items.length, 1000);
      assert.ok(duration < 100, `Expected < 100ms, got ${duration.toFixed(2)}ms`);
    });

    void it("should stringify large object in < 100ms", () => {
      const data = {
        items: Array.from({ length: 1000 }, (_, i) => ({
          id: i,
          name: `item-${i}`,
          values: [1, 2, 3, 4, 5],
        })),
      };

      const start = performance.now();

      const json = JSON.stringify(data);

      const end = performance.now();
      const duration = end - start;

      assert.ok(json.length > 0);
      assert.ok(duration < 100, `Expected < 100ms, got ${duration.toFixed(2)}ms`);
    });
  });
});

/**
 * Performance regression tests.
 * These ensure that optimizations don't accidentally make things slower.
 */
void describe("Performance regression tests", () => {
  void it("should not regress on basic array operations", () => {
    const iterations = 100;
    const durations: number[] = [];

    for (let i = 0; i < iterations; i++) {
      const start = performance.now();

      const array = Array.from({ length: 1000 }, (_, j) => j);
      const doubled = array.map((x) => x * 2);
      const _filtered = doubled.filter((x) => x % 4 === 0);

      const end = performance.now();
      durations.push(end - start);
    }

    const avgDuration = durations.reduce((a, b) => a + b) / durations.length;
    const maxDuration = Math.max(...durations);

    // Average should be under 5ms
    assert.ok(avgDuration < 5, `Average: ${avgDuration.toFixed(2)}ms (expected < 5ms)`);

    // No single iteration should take more than 20ms
    assert.ok(maxDuration < 20, `Max: ${maxDuration.toFixed(2)}ms (expected < 20ms)`);
  });
});
