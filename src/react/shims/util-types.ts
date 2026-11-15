// Stub for node:util/types
// Provides minimal type checking functions for browser environment

export function isArrayBuffer(value: unknown): value is ArrayBuffer {
  return value instanceof ArrayBuffer;
}

export function isTypedArray(value: unknown): boolean {
  return ArrayBuffer.isView(value) && !(value instanceof DataView);
}

export function isUint8Array(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array;
}

export function isUint8ClampedArray(value: unknown): value is Uint8ClampedArray {
  return value instanceof Uint8ClampedArray;
}

export function isUint16Array(value: unknown): value is Uint16Array {
  return value instanceof Uint16Array;
}

export function isUint32Array(value: unknown): value is Uint32Array {
  return value instanceof Uint32Array;
}

export function isInt8Array(value: unknown): value is Int8Array {
  return value instanceof Int8Array;
}

export function isInt16Array(value: unknown): value is Int16Array {
  return value instanceof Int16Array;
}

export function isInt32Array(value: unknown): value is Int32Array {
  return value instanceof Int32Array;
}

export function isFloat32Array(value: unknown): value is Float32Array {
  return value instanceof Float32Array;
}

export function isFloat64Array(value: unknown): value is Float64Array {
  return value instanceof Float64Array;
}

export function isBigInt64Array(value: unknown): value is BigInt64Array {
  return value instanceof BigInt64Array;
}

export function isBigUint64Array(value: unknown): value is BigUint64Array {
  return value instanceof BigUint64Array;
}

export function isDataView(value: unknown): value is DataView {
  return value instanceof DataView;
}

export function isSharedArrayBuffer(value: unknown): value is SharedArrayBuffer {
  return typeof SharedArrayBuffer !== "undefined" && value instanceof SharedArrayBuffer;
}

export function isAsyncFunction(value: unknown): boolean {
  return typeof value === "function" && value.constructor.name === "AsyncFunction";
}

export function isGeneratorFunction(value: unknown): boolean {
  return typeof value === "function" && value.constructor.name === "GeneratorFunction";
}

export function isPromise(value: unknown): value is Promise<unknown> {
  return value instanceof Promise;
}

export function isMap(value: unknown): value is Map<unknown, unknown> {
  return value instanceof Map;
}

export function isSet(value: unknown): value is Set<unknown> {
  return value instanceof Set;
}

export function isWeakMap(value: unknown): value is WeakMap<object, unknown> {
  return value instanceof WeakMap;
}

export function isWeakSet(value: unknown): value is WeakSet<object> {
  return value instanceof WeakSet;
}

export function isDate(value: unknown): value is Date {
  return value instanceof Date;
}

export function isRegExp(value: unknown): value is RegExp {
  return value instanceof RegExp;
}

// Stub implementations for less common types
export function isBoxedPrimitive(value: unknown): boolean {
  return (
    value instanceof Number ||
    value instanceof String ||
    value instanceof Boolean ||
    value instanceof Symbol ||
    (typeof BigInt !== "undefined" && value instanceof BigInt)
  );
}

export function isNativeError(value: unknown): value is Error {
  return value instanceof Error;
}

export function isModuleNamespaceObject(_value: unknown): boolean {
  // Cannot reliably detect in browser
  return false;
}

export function isProxy(_value: unknown): boolean {
  // Cannot detect proxies in JavaScript
  return false;
}
