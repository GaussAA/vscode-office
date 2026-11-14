import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isObject,
  isArray,
  isString,
  isNumber,
  isBoolean,
  isNullish,
  isNonEmptyString,
  hasProperty,
  hasStringProperty,
  hasNumberProperty,
  getStringProperty,
  getNumberProperty,
  getBooleanProperty,
  assertDefined,
  assertString,
  assertNumber,
  assertNever,
} from "../../src/common/typeGuards.ts";

// ===== Basic Type Guards =====

test("isObject: identifies objects", () => {
  assert.strictEqual(isObject({}), true);
  assert.strictEqual(isObject({ a: 1 }), true);
});

test("isObject: rejects non-objects", () => {
  assert.strictEqual(isObject(null), false);
  assert.strictEqual(isObject([]), false);
  assert.strictEqual(isObject("string"), false);
  assert.strictEqual(isObject(42), false);
  assert.strictEqual(isObject(undefined), false);
});

test("isArray: identifies arrays", () => {
  assert.strictEqual(isArray([]), true);
  assert.strictEqual(isArray([1, 2, 3]), true);
});

test("isArray: rejects non-arrays", () => {
  assert.strictEqual(isArray({}), false);
  assert.strictEqual(isArray("string"), false);
  assert.strictEqual(isArray(null), false);
});

test("isString: identifies strings", () => {
  assert.strictEqual(isString(""), true);
  assert.strictEqual(isString("hello"), true);
});

test("isString: rejects non-strings", () => {
  assert.strictEqual(isString(42), false);
  assert.strictEqual(isString(null), false);
  assert.strictEqual(isString({}), false);
});

test("isNumber: identifies numbers", () => {
  assert.strictEqual(isNumber(0), true);
  assert.strictEqual(isNumber(42), true);
  assert.strictEqual(isNumber(-3.14), true);
});

test("isNumber: rejects NaN and non-numbers", () => {
  assert.strictEqual(isNumber(NaN), false);
  assert.strictEqual(isNumber("42"), false);
  assert.strictEqual(isNumber(null), false);
});

test("isBoolean: identifies booleans", () => {
  assert.strictEqual(isBoolean(true), true);
  assert.strictEqual(isBoolean(false), true);
});

test("isBoolean: rejects non-booleans", () => {
  assert.strictEqual(isBoolean(1), false);
  assert.strictEqual(isBoolean("true"), false);
  assert.strictEqual(isBoolean(null), false);
});

test("isNullish: identifies null and undefined", () => {
  assert.strictEqual(isNullish(null), true);
  assert.strictEqual(isNullish(undefined), true);
});

test("isNullish: rejects other values", () => {
  assert.strictEqual(isNullish(0), false);
  assert.strictEqual(isNullish(""), false);
  assert.strictEqual(isNullish(false), false);
});

test("isNonEmptyString: identifies non-empty strings", () => {
  assert.strictEqual(isNonEmptyString("hello"), true);
  assert.strictEqual(isNonEmptyString("a"), true);
});

test("isNonEmptyString: rejects empty strings and non-strings", () => {
  assert.strictEqual(isNonEmptyString(""), false);
  assert.strictEqual(isNonEmptyString(42), false);
  assert.strictEqual(isNonEmptyString(null), false);
});

// ===== Property Checks =====

test("hasProperty: detects existing properties", () => {
  const obj = { name: "Alice", age: 30 };
  assert.strictEqual(hasProperty(obj, "name"), true);
  assert.strictEqual(hasProperty(obj, "age"), true);
});

test("hasProperty: rejects missing properties", () => {
  const obj = { name: "Alice" };
  assert.strictEqual(hasProperty(obj, "age"), false);
});

test("hasProperty: rejects non-objects", () => {
  assert.strictEqual(hasProperty(null, "name"), false);
  assert.strictEqual(hasProperty("string", "length"), false);
});

test("hasStringProperty: detects string properties", () => {
  const obj = { name: "Alice", age: 30 };
  assert.strictEqual(hasStringProperty(obj, "name"), true);
});

test("hasStringProperty: rejects non-string properties", () => {
  const obj = { name: "Alice", age: 30 };
  assert.strictEqual(hasStringProperty(obj, "age"), false);
});

test("hasNumberProperty: detects number properties", () => {
  const obj = { name: "Alice", age: 30 };
  assert.strictEqual(hasNumberProperty(obj, "age"), true);
});

test("hasNumberProperty: rejects non-number properties", () => {
  const obj = { name: "Alice", age: 30 };
  assert.strictEqual(hasNumberProperty(obj, "name"), false);
});

// ===== Safe Property Getters =====

test("getStringProperty: extracts string properties", () => {
  const obj = { name: "Alice" };
  assert.strictEqual(getStringProperty(obj, "name"), "Alice");
});

test("getStringProperty: returns fallback for missing properties", () => {
  const obj = { name: "Alice" };
  assert.strictEqual(getStringProperty(obj, "age", "unknown"), "unknown");
});

test("getStringProperty: returns fallback for wrong type", () => {
  const obj = { age: 30 };
  assert.strictEqual(getStringProperty(obj, "age", "default"), "default");
});

test("getStringProperty: handles non-objects", () => {
  assert.strictEqual(getStringProperty(null, "name", "default"), "default");
  assert.strictEqual(getStringProperty(42, "name", "default"), "default");
});

test("getNumberProperty: extracts number properties", () => {
  const obj = { age: 30 };
  assert.strictEqual(getNumberProperty(obj, "age"), 30);
});

test("getNumberProperty: returns fallback for missing properties", () => {
  const obj = { name: "Alice" };
  assert.strictEqual(getNumberProperty(obj, "age", -1), -1);
});

test("getNumberProperty: returns fallback for wrong type", () => {
  const obj = { name: "Alice" };
  assert.strictEqual(getNumberProperty(obj, "name", 0), 0);
});

test("getBooleanProperty: extracts boolean properties", () => {
  const obj = { active: true };
  assert.strictEqual(getBooleanProperty(obj, "active"), true);
});

test("getBooleanProperty: returns fallback for missing properties", () => {
  const obj = { name: "Alice" };
  assert.strictEqual(getBooleanProperty(obj, "active", false), false);
});

test("getBooleanProperty: returns fallback for wrong type", () => {
  const obj = { active: 1 };
  assert.strictEqual(getBooleanProperty(obj, "active", false), false);
});

// ===== Assertions =====

test("assertDefined: returns non-nullish values", () => {
  assert.strictEqual(assertDefined("value"), "value");
  assert.strictEqual(assertDefined(0), 0);
  assert.strictEqual(assertDefined(false), false);
});

test("assertDefined: throws for null", () => {
  assert.throws(() => assertDefined(null), /must be defined/);
});

test("assertDefined: throws for undefined", () => {
  assert.throws(() => assertDefined(undefined), /must be defined/);
});

test("assertDefined: uses custom error message", () => {
  assert.throws(() => assertDefined(null, "Custom error"), /Custom error/);
});

test("assertString: returns strings", () => {
  assert.strictEqual(assertString("hello"), "hello");
});

test("assertString: throws for non-strings", () => {
  assert.throws(() => assertString(42), /must be a string/);
  assert.throws(() => assertString(null), /must be a string/);
});

test("assertString: uses custom error message", () => {
  assert.throws(() => assertString(42, "Need string"), /Need string/);
});

test("assertNumber: returns numbers", () => {
  assert.strictEqual(assertNumber(42), 42);
  assert.strictEqual(assertNumber(0), 0);
});

test("assertNumber: throws for non-numbers", () => {
  assert.throws(() => assertNumber("42"), /must be a number/);
  assert.throws(() => assertNumber(null), /must be a number/);
  assert.throws(() => assertNumber(NaN), /must be a number/);
});

test("assertNumber: uses custom error message", () => {
  assert.throws(() => assertNumber("42", "Need number"), /Need number/);
});

test("assertNever: always throws", () => {
  // Cast to never to test the function
  assert.throws(() => assertNever("unexpected" as never), /Unexpected value/);
});

// ===== Type Narrowing in Context =====

test("type guards enable safe property access", () => {
  const value: unknown = { name: "Alice", age: 30 };

  if (isObject(value)) {
    // TypeScript knows value is Record<string, unknown>
    assert.strictEqual(typeof value.name, "string");
  } else {
    assert.fail("Should be an object");
  }
});

test("property guards enable typed access", () => {
  const value: unknown = { name: "Alice" };

  if (hasStringProperty(value, "name")) {
    // TypeScript knows value.name is a string
    assert.strictEqual(value.name.length, 5);
  } else {
    assert.fail("Should have string property");
  }
});
