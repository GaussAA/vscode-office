/**
 * Common Type Utilities
 *
 * Reusable type guards, type predicates, and utility types shared across
 * the codebase. Use these to reduce type assertions and improve type safety.
 *
 * @module typeGuards
 */

/**
 * Type guard to check if a value is a non-null object.
 *
 * Useful for narrowing `unknown` to object types before property access.
 *
 * @param value - Value to check
 * @returns True if value is a non-null object
 * @example
 * ```ts
 * if (isObject(value)) {
 *   // TypeScript knows value is Record<string, unknown>
 *   const name = value.name;
 * }
 * ```
 */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Type guard to check if a value is an array.
 *
 * @param value - Value to check
 * @returns True if value is an array
 */
export function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

/**
 * Type guard to check if a value is a string.
 *
 * @param value - Value to check
 * @returns True if value is a string
 */
export function isString(value: unknown): value is string {
  return typeof value === "string";
}

/**
 * Type guard to check if a value is a number.
 *
 * @param value - Value to check
 * @returns True if value is a number (excluding NaN)
 */
export function isNumber(value: unknown): value is number {
  return typeof value === "number" && !Number.isNaN(value);
}

/**
 * Type guard to check if a value is a boolean.
 *
 * @param value - Value to check
 * @returns True if value is a boolean
 */
export function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

/**
 * Type guard to check if a value is null or undefined.
 *
 * @param value - Value to check
 * @returns True if value is null or undefined
 */
export function isNullish(value: unknown): value is null | undefined {
  return value === null || value === undefined;
}

/**
 * Type guard to check if a value is a non-empty string.
 *
 * @param value - Value to check
 * @returns True if value is a non-empty string
 */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * Type guard to check if an object has a specific property.
 *
 * @param obj - Object to check
 * @param key - Property key to look for
 * @returns True if object has the property
 * @example
 * ```ts
 * if (hasProperty(obj, "name")) {
 *   // TypeScript knows obj has a "name" property
 *   console.log(obj.name);
 * }
 * ```
 */
export function hasProperty<K extends string>(obj: unknown, key: K): obj is Record<K, unknown> {
  return isObject(obj) && key in obj;
}

/**
 * Type guard to check if an object has a string property.
 *
 * @param obj - Object to check
 * @param key - Property key to look for
 * @returns True if object has a string property
 */
export function hasStringProperty<K extends string>(
  obj: unknown,
  key: K,
): obj is Record<K, string> {
  return hasProperty(obj, key) && isString(obj[key]);
}

/**
 * Type guard to check if an object has a number property.
 *
 * @param obj - Object to check
 * @param key - Property key to look for
 * @returns True if object has a number property
 */
export function hasNumberProperty<K extends string>(
  obj: unknown,
  key: K,
): obj is Record<K, number> {
  return hasProperty(obj, key) && isNumber(obj[key]);
}

/**
 * Safely extract a string property from an unknown object.
 *
 * @param obj - Object to extract from
 * @param key - Property key
 * @param fallback - Default value if property is missing or wrong type
 * @returns The string value or fallback
 */
export function getStringProperty(obj: unknown, key: string, fallback = ""): string {
  if (!isObject(obj)) return fallback;
  const value = obj[key];
  return isString(value) ? value : fallback;
}

/**
 * Safely extract a number property from an unknown object.
 *
 * @param obj - Object to extract from
 * @param key - Property key
 * @param fallback - Default value if property is missing or wrong type
 * @returns The number value or fallback
 */
export function getNumberProperty(obj: unknown, key: string, fallback = 0): number {
  if (!isObject(obj)) return fallback;
  const value = obj[key];
  return isNumber(value) ? value : fallback;
}

/**
 * Safely extract a boolean property from an unknown object.
 *
 * @param obj - Object to extract from
 * @param key - Property key
 * @param fallback - Default value if property is missing or wrong type
 * @returns The boolean value or fallback
 */
export function getBooleanProperty(obj: unknown, key: string, fallback = false): boolean {
  if (!isObject(obj)) return fallback;
  const value = obj[key];
  return isBoolean(value) ? value : fallback;
}

/**
 * Assert that a value is defined (not null or undefined).
 *
 * Throws an error if the value is nullish.
 *
 * @param value - Value to check
 * @param message - Optional error message
 * @returns The non-nullish value
 * @throws {Error} If value is null or undefined
 */
export function assertDefined<T>(value: T, message?: string): NonNullable<T> {
  if (isNullish(value)) {
    throw new Error(message ?? "Value must be defined");
  }
  return value as NonNullable<T>;
}

/**
 * Assert that a value is a string.
 *
 * @param value - Value to check
 * @param message - Optional error message
 * @returns The string value
 * @throws {Error} If value is not a string
 */
export function assertString(value: unknown, message?: string): string {
  if (!isString(value)) {
    throw new Error(message ?? "Value must be a string");
  }
  return value;
}

/**
 * Assert that a value is a number.
 *
 * @param value - Value to check
 * @param message - Optional error message
 * @returns The number value
 * @throws {Error} If value is not a number
 */
export function assertNumber(value: unknown, message?: string): number {
  if (!isNumber(value)) {
    throw new Error(message ?? "Value must be a number");
  }
  return value;
}

/**
 * Exhaustiveness check for discriminated unions.
 *
 * Use in switch statements to ensure all cases are handled.
 *
 * @param value - The value that should never be reached
 * @example
 * ```ts
 * type Action = { type: "add" } | { type: "remove" };
 * function handle(action: Action) {
 *   switch (action.type) {
 *     case "add": return;
 *     case "remove": return;
 *     default: return assertNever(action);
 *   }
 * }
 * ```
 */
export function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${JSON.stringify(value)}`);
}
