import { test } from "node:test";
import assert from "node:assert/strict";
import { firstMatchKey, collectMatchPaths } from "../../src/react/view/json/jsonPreviewFormat.ts";

// ===== Find First Match =====

test("firstMatchKey: finds key match", () => {
  const obj = { userName: "Alice", email: "alice@example.com" };
  const result = firstMatchKey(obj, "user");
  assert(result !== null);
  assert(result.includes("userName"));
});

test("firstMatchKey: finds value match", () => {
  const obj = { name: "Alice", city: "Boston" };
  const result = firstMatchKey(obj, "boston");
  assert(result !== null);
  assert(result.includes("city"));
});

test("firstMatchKey: searches nested objects", () => {
  const obj = { user: { profile: { name: "Alice" } } };
  const result = firstMatchKey(obj, "alice");
  assert(result !== null);
});

test("firstMatchKey: searches arrays", () => {
  const obj = { items: ["apple", "banana", "cherry"] };
  const result = firstMatchKey(obj, "banana");
  assert(result !== null);
});

test("firstMatchKey: returns null when no match", () => {
  const obj = { name: "Alice" };
  const result = firstMatchKey(obj, "bob");
  assert.strictEqual(result, null);
});

test("firstMatchKey: is case-insensitive", () => {
  const obj = { Name: "Alice" };
  const result1 = firstMatchKey(obj, "name");
  const result2 = firstMatchKey(obj, "ALICE");
  assert(result1 !== null);
  assert(result2 !== null);
});

test("firstMatchKey: handles empty term", () => {
  const obj = { name: "Alice" };
  const result = firstMatchKey(obj, "");
  assert.strictEqual(result, null);
});

test("firstMatchKey: handles whitespace term", () => {
  const obj = { name: "Alice" };
  const result = firstMatchKey(obj, "   ");
  assert.strictEqual(result, null);
});

test("firstMatchKey: finds first match in deep structure", () => {
  const obj = {
    a: { target: 1 },
    b: { target: 2 },
    c: { target: 3 },
  };
  const result = firstMatchKey(obj, "target");
  assert(result !== null);
  assert(result.includes("target"));
});

test("firstMatchKey: handles numeric values", () => {
  const obj = { id: 12345, name: "Test" };
  const result = firstMatchKey(obj, "12345");
  assert(result !== null);
});

test("firstMatchKey: handles boolean values", () => {
  const obj = { active: true, deleted: false };
  const result = firstMatchKey(obj, "true");
  assert(result !== null);
});

test("firstMatchKey: handles null values", () => {
  const obj = { value: null };
  const result = firstMatchKey(obj, "null");
  assert(result !== null);
});

// ===== Collect Match Paths =====

test("collectMatchPaths: collects multiple matches", () => {
  const obj = {
    user1: "Alice",
    user2: "Bob",
    admin: "Charlie",
  };
  const results = collectMatchPaths(obj, "user");
  assert.strictEqual(results.length, 2);
  assert(results[0].path.includes("user1"));
  assert(results[1].path.includes("user2"));
});

test("collectMatchPaths: includes path and snippet", () => {
  const obj = { name: "Alice" };
  const results = collectMatchPaths(obj, "alice");
  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].path, "name");
  assert.strictEqual(results[0].snippet, "Alice");
});

test("collectMatchPaths: respects limit", () => {
  const obj: Record<string, string> = {};
  for (let i = 0; i < 100; i++) {
    obj[`match${i}`] = "value";
  }
  const results = collectMatchPaths(obj, "match", 10);
  assert.strictEqual(results.length, 10);
});

test("collectMatchPaths: searches nested structures", () => {
  const obj = {
    level1: {
      level2: {
        target: "found",
      },
    },
  };
  const results = collectMatchPaths(obj, "target");
  assert.strictEqual(results.length, 1);
  assert(results[0].path.includes("level1"));
  assert(results[0].path.includes("level2"));
  assert(results[0].path.includes("target"));
});

test("collectMatchPaths: searches array elements", () => {
  const obj = {
    items: ["apple", "banana", "cherry"],
  };
  const results = collectMatchPaths(obj, "banana");
  assert.strictEqual(results.length, 1);
  assert(results[0].path.includes("items[1]"));
});

test("collectMatchPaths: returns empty for no matches", () => {
  const obj = { name: "Alice" };
  const results = collectMatchPaths(obj, "bob");
  assert.strictEqual(results.length, 0);
});

test("collectMatchPaths: returns empty for empty term", () => {
  const obj = { name: "Alice" };
  const results = collectMatchPaths(obj, "");
  assert.strictEqual(results.length, 0);
});

test("collectMatchPaths: is case-insensitive", () => {
  const obj = { UserName: "Alice" };
  const results = collectMatchPaths(obj, "username");
  assert.strictEqual(results.length, 1);
});

test("collectMatchPaths: truncates long snippets", () => {
  const longText = "x".repeat(200);
  const obj = { field: longText };
  const results = collectMatchPaths(obj, "xxx");
  assert.strictEqual(results.length, 1);
  assert(results[0].snippet.length <= 160);
});

test("collectMatchPaths: matches key names", () => {
  const obj = {
    userName: "Alice",
    userEmail: "alice@example.com",
    admin: "Bob",
  };
  const results = collectMatchPaths(obj, "user");
  assert(results.length >= 2);
  // Should match keys containing "user"
  const keyMatches = results.filter((r) => r.path.toLowerCase().includes("user"));
  assert(keyMatches.length >= 2);
});

test("collectMatchPaths: handles mixed types", () => {
  const obj = {
    string: "test",
    number: 42,
    boolean: true,
    null: null,
    nested: { value: "test" },
  };
  const results = collectMatchPaths(obj, "test");
  assert(results.length >= 2); // "string" and "nested.value"
});

test("collectMatchPaths: stops at node limit", () => {
  // Create a very large structure
  const large: any = {};
  for (let i = 0; i < 10000; i++) {
    large[`item${i}`] = { value: "match" };
  }
  const results = collectMatchPaths(large, "match");
  // Should stop before processing all 10000 items
  assert(results.length < 10000);
});

test("collectMatchPaths: handles array indices in path", () => {
  const obj = {
    users: [{ name: "Alice" }, { name: "Bob" }, { name: "Charlie" }],
  };
  const results = collectMatchPaths(obj, "bob");
  assert.strictEqual(results.length, 1);
  assert(results[0].path.includes("[1]"));
});

test("collectMatchPaths: matches partial strings", () => {
  const obj = { email: "alice@example.com" };
  const results = collectMatchPaths(obj, "example");
  assert.strictEqual(results.length, 1);
  assert(results[0].snippet.includes("example"));
});
