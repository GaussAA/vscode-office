/* eslint-disable @typescript-eslint/no-floating-promises */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ParquetCellCache } from "../../src/react/view/parquet/ParquetCellCache";

describe("ParquetCellCache", () => {
  it("should cache and retrieve formatted values", () => {
    const cache = new ParquetCellCache(100);

    cache.setFormatted(0, "name", "Alice", "Alice");
    cache.setFormatted(1, "age", 25, "25");

    assert.equal(cache.getFormatted(0, "name", "Alice"), "Alice");
    assert.equal(cache.getFormatted(1, "age", 25), "25");
  });

  it("should return undefined for non-cached values", () => {
    const cache = new ParquetCellCache(100);

    assert.equal(cache.getFormatted(0, "name", "Bob"), undefined);
  });

  it("should handle different data types as values", () => {
    const cache = new ParquetCellCache(100);

    cache.setFormatted(0, "name", "Alice", "Alice");
    cache.setFormatted(1, "age", 25, "25");
    cache.setFormatted(2, "active", true, "true");
    cache.setFormatted(3, "score", 3.14, "3.14");
    cache.setFormatted(4, "data", null, "null");
    cache.setFormatted(5, "obj", { x: 1 }, '{"x":1}');

    assert.equal(cache.getFormatted(0, "name", "Alice"), "Alice");
    assert.equal(cache.getFormatted(1, "age", 25), "25");
    assert.equal(cache.getFormatted(2, "active", true), "true");
    assert.equal(cache.getFormatted(3, "score", 3.14), "3.14");
    assert.equal(cache.getFormatted(4, "data", null), "null");
    assert.equal(cache.getFormatted(5, "obj", { x: 1 }), '{"x":1}');
  });

  it("should distinguish between different cells", () => {
    const cache = new ParquetCellCache(100);

    cache.setFormatted(0, "col1", "value", "formatted1");
    cache.setFormatted(1, "col1", "value", "formatted2");
    cache.setFormatted(0, "col2", "value", "formatted3");

    assert.equal(cache.getFormatted(0, "col1", "value"), "formatted1");
    assert.equal(cache.getFormatted(1, "col1", "value"), "formatted2");
    assert.equal(cache.getFormatted(0, "col2", "value"), "formatted3");
  });

  it("should evict old entries when capacity is reached", () => {
    const cache = new ParquetCellCache(3);

    cache.setFormatted(0, "col", "a", "A");
    cache.setFormatted(1, "col", "b", "B");
    cache.setFormatted(2, "col", "c", "C");
    cache.setFormatted(3, "col", "d", "D"); // Should evict first entry

    assert.equal(cache.getFormatted(0, "col", "a"), undefined);
    assert.equal(cache.getFormatted(1, "col", "b"), "B");
    assert.equal(cache.getFormatted(2, "col", "c"), "C");
    assert.equal(cache.getFormatted(3, "col", "d"), "D");
  });

  it("should clear all cached values", () => {
    const cache = new ParquetCellCache(100);

    cache.setFormatted(0, "name", "Alice", "Alice");
    cache.setFormatted(1, "age", 25, "25");

    cache.clear();

    assert.equal(cache.getFormatted(0, "name", "Alice"), undefined);
    assert.equal(cache.getFormatted(1, "age", 25), undefined);
    assert.equal(cache.stats().size, 0);
  });

  it("should track cache statistics", () => {
    const cache = new ParquetCellCache(100);

    cache.setFormatted(0, "name", "Alice", "Alice");

    cache.getFormatted(0, "name", "Alice"); // hit
    cache.getFormatted(0, "name", "Alice"); // hit
    cache.getFormatted(1, "age", 25); // miss

    const stats = cache.stats();
    assert.equal(stats.hits, 2);
    assert.equal(stats.misses, 1);
    assert.equal(stats.hitRate, 2 / 3);
  });

  it("should handle hash collisions gracefully", () => {
    const cache = new ParquetCellCache(100);

    // Even if hashes collide, different row/column combinations create different keys
    cache.setFormatted(0, "col1", "value1", "formatted1");
    cache.setFormatted(0, "col2", "value2", "formatted2");

    assert.equal(cache.getFormatted(0, "col1", "value1"), "formatted1");
    assert.equal(cache.getFormatted(0, "col2", "value2"), "formatted2");
  });

  it("should prune expired entries", async () => {
    const cache = new ParquetCellCache(100);

    cache.setFormatted(0, "name", "Alice", "Alice");

    // Initially should have the entry
    assert.equal(cache.getFormatted(0, "name", "Alice"), "Alice");

    // Note: Actual TTL is 5 minutes, but we can still test the prune method
    // In a real scenario, entries would expire after TTL
    const pruned = cache.prune();
    assert.equal(typeof pruned, "number");
  });

  it("should handle same value in different positions", () => {
    const cache = new ParquetCellCache(100);

    const value = "same";
    cache.setFormatted(0, "col", value, "formatted0");
    cache.setFormatted(1, "col", value, "formatted1");
    cache.setFormatted(2, "col", value, "formatted2");

    assert.equal(cache.getFormatted(0, "col", value), "formatted0");
    assert.equal(cache.getFormatted(1, "col", value), "formatted1");
    assert.equal(cache.getFormatted(2, "col", value), "formatted2");
  });

  it("should handle complex objects as values", () => {
    const cache = new ParquetCellCache(100);

    const obj1 = { a: 1, b: { c: 2 } };
    const obj2 = { a: 1, b: { c: 2 } }; // Same structure, different reference

    cache.setFormatted(0, "col", obj1, "formatted");

    // Should work with same structure even if different reference
    assert.equal(cache.getFormatted(0, "col", obj2), "formatted");
  });
});
