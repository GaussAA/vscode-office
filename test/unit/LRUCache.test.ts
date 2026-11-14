/* eslint-disable @typescript-eslint/no-floating-promises */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { LRUCache } from "../../src/util/LRUCache";

describe("LRUCache", () => {
  describe("Basic operations", () => {
    it("should set and get values", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);

      assert.equal(cache.get("a"), 1);
      assert.equal(cache.get("b"), 2);
      assert.equal(cache.get("c"), 3);
      assert.equal(cache.size(), 3);
    });

    it("should return undefined for non-existent keys", () => {
      const cache = new LRUCache<string, number>(3);
      assert.equal(cache.get("nonexistent"), undefined);
    });

    it("should update existing keys", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("a", 1);
      cache.set("a", 2);

      assert.equal(cache.get("a"), 2);
      assert.equal(cache.size(), 1);
    });
  });

  describe("LRU eviction", () => {
    it("should evict least recently used item when capacity is reached", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);
      cache.set("d", 4); // Should evict 'a'

      assert.equal(cache.get("a"), undefined);
      assert.equal(cache.get("b"), 2);
      assert.equal(cache.get("c"), 3);
      assert.equal(cache.get("d"), 4);
      assert.equal(cache.size(), 3);
    });

    it("should update LRU order on get", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);

      // Access 'a' to make it most recently used
      cache.get("a");

      // Add new item, should evict 'b' (least recently used)
      cache.set("d", 4);

      assert.equal(cache.get("a"), 1);
      assert.equal(cache.get("b"), undefined);
      assert.equal(cache.get("c"), 3);
      assert.equal(cache.get("d"), 4);
    });

    it("should update LRU order on set", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);

      // Update 'a' to make it most recently used
      cache.set("a", 10);

      // Add new item, should evict 'b'
      cache.set("d", 4);

      assert.equal(cache.get("a"), 10);
      assert.equal(cache.get("b"), undefined);
      assert.equal(cache.get("c"), 3);
      assert.equal(cache.get("d"), 4);
    });
  });

  describe("TTL (Time To Live)", () => {
    it("should expire entries after TTL", async () => {
      const cache = new LRUCache<string, number>(3, 50); // 50ms TTL
      cache.set("a", 1);

      assert.equal(cache.get("a"), 1);

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 60));

      assert.equal(cache.get("a"), undefined);
      assert.equal(cache.size(), 0);
    });

    it("should not expire entries before TTL", async () => {
      const cache = new LRUCache<string, number>(3, 100); // 100ms TTL
      cache.set("a", 1);

      // Wait less than TTL
      await new Promise((resolve) => setTimeout(resolve, 50));

      assert.equal(cache.get("a"), 1);
    });

    it("should update timestamp on get", async () => {
      const cache = new LRUCache<string, number>(3, 100); // 100ms TTL
      cache.set("a", 1);

      // Wait 60ms
      await new Promise((resolve) => setTimeout(resolve, 60));

      // Access refreshes the entry
      assert.equal(cache.get("a"), 1);

      // Wait another 60ms (total 120ms from initial set)
      await new Promise((resolve) => setTimeout(resolve, 60));

      // Should still be valid because get updated the timestamp
      assert.equal(cache.get("a"), 1);
    });
  });

  describe("Cache statistics", () => {
    it("should track hits and misses", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("a", 1);
      cache.set("b", 2);

      cache.get("a"); // hit
      cache.get("b"); // hit
      cache.get("c"); // miss
      cache.get("d"); // miss

      const stats = cache.stats();
      assert.equal(stats.hits, 2);
      assert.equal(stats.misses, 2);
      assert.equal(stats.hitRate, 0.5);
    });

    it("should calculate hit rate correctly", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("a", 1);

      cache.get("a"); // hit
      cache.get("a"); // hit
      cache.get("a"); // hit
      cache.get("b"); // miss

      assert.equal(cache.hitRate(), 0.75);
    });

    it("should return 0 hit rate when no accesses", () => {
      const cache = new LRUCache<string, number>(3);
      assert.equal(cache.hitRate(), 0);
    });
  });

  describe("Additional operations", () => {
    it("should check if key exists with has()", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("a", 1);

      assert.equal(cache.has("a"), true);
      assert.equal(cache.has("b"), false);
    });

    it("should delete specific keys", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("a", 1);
      cache.set("b", 2);

      assert.equal(cache.delete("a"), true);
      assert.equal(cache.delete("a"), false);
      assert.equal(cache.get("a"), undefined);
      assert.equal(cache.get("b"), 2);
      assert.equal(cache.size(), 1);
    });

    it("should clear all entries", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);

      cache.get("a"); // Create some stats

      cache.clear();

      assert.equal(cache.size(), 0);
      assert.equal(cache.has("a"), false);
      assert.equal(cache.stats().hits, 0);
      assert.equal(cache.stats().misses, 0);
    });

    it("should prune expired entries", async () => {
      const cache = new LRUCache<string, number>(5, 50); // 50ms TTL
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 60));

      // Add new entries that won't expire
      cache.set("d", 4);
      cache.set("e", 5);

      const removed = cache.prune();
      assert.equal(removed, 3); // a, b, c expired
      assert.equal(cache.size(), 2); // d, e remain
    });

    it("should not prune when no TTL", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("a", 1);
      cache.set("b", 2);

      const removed = cache.prune();
      assert.equal(removed, 0);
      assert.equal(cache.size(), 2);
    });
  });

  describe("Edge cases", () => {
    it("should throw error for invalid capacity", () => {
      assert.throws(() => new LRUCache<string, number>(0));
      assert.throws(() => new LRUCache<string, number>(-1));
    });

    it("should handle capacity of 1", () => {
      const cache = new LRUCache<string, number>(1);
      cache.set("a", 1);
      cache.set("b", 2);

      assert.equal(cache.get("a"), undefined);
      assert.equal(cache.get("b"), 2);
      assert.equal(cache.size(), 1);
    });

    it("should handle complex objects as keys", () => {
      const cache = new LRUCache<object, string>(3);
      const key1 = { id: 1 };
      const key2 = { id: 2 };

      cache.set(key1, "value1");
      cache.set(key2, "value2");

      assert.equal(cache.get(key1), "value1");
      assert.equal(cache.get(key2), "value2");
    });

    it("should handle undefined and null as values", () => {
      const cache = new LRUCache<string, any>(3);
      cache.set("a", undefined);
      cache.set("b", null);

      assert.equal(cache.get("a"), undefined);
      assert.equal(cache.get("b"), null);
      assert.equal(cache.has("a"), true);
      assert.equal(cache.has("b"), true);
    });
  });
});
