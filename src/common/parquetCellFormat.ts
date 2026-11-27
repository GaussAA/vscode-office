/**
 * Parquet cell value formatting for display.
 *
 * Converts Parquet column values (bytes, dates, nested structures, etc.) into
 * human-readable strings for table cells. Used by both the webview table and
 * the inspector panel.
 *
 * @module parquetCellFormat
 */

import { toDisplayText } from "@/common/displayText";

/** A binary cell is bytes; a JSON object of control characters is not a value. */
const BINARY_PREVIEW_BYTES = 24;

function formatBinary(bytes: Uint8Array): string {
  if (bytes.byteLength === 0) return "0 B";
  const preview = Array.from(bytes.subarray(0, BINARY_PREVIEW_BYTES), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join(" ");
  return `0x${preview}${bytes.byteLength > BINARY_PREVIEW_BYTES ? ` … (${bytes.byteLength} B)` : ""}`;
}

export function isBinaryType(type: string): boolean {
  const upper = type.toUpperCase();
  return (
    upper === "BYTE_ARRAY" ||
    upper === "FIXED_LEN_BYTE_ARRAY" ||
    upper.includes("BSON") ||
    upper.includes("GEOMETRY") ||
    upper.includes("GEOGRAPHY")
  );
}

function isTextType(type: string): boolean {
  const upper = type.toUpperCase();
  return (
    upper.includes("STRING") ||
    upper.includes("UTF8") ||
    upper.includes("CHAR") ||
    upper.includes("JSON") ||
    upper.includes("UUID") ||
    upper.includes("ENUM")
  );
}

const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
const utf8Encoder = new TextEncoder();

/** Decode only when the bytes are valid UTF-8; otherwise keep the hex representation. */
function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    return utf8Decoder.decode(bytes);
  } catch {
    return null;
  }
}

function formatNestedBytes(bytes: Uint8Array): string {
  return decodeUtf8(bytes) ?? formatBinary(bytes);
}

function formatUuid(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return hex.length === 32
    ? `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
    : formatBinary(bytes);
}

export function formatCellValue(value: unknown, declaredType?: string): string {
  if (value instanceof Uint8Array) {
    if (declaredType?.toUpperCase() === "UUID") return formatUuid(value);
    if (declaredType && isTextType(declaredType)) {
      return decodeUtf8(value) ?? formatBinary(value);
    }
    return formatBinary(value);
  }
  if (value instanceof ArrayBuffer) {
    return formatCellValue(new Uint8Array(value), declaredType);
  }
  // hyparquet decodes a plain BYTE_ARRAY as UTF-8 by default. That is convenient for
  // text but turns arbitrary bytes into control characters; only the declared physical
  // type can tell us whether those bytes were meant to be text.
  if (typeof value === "string" && declaredType && isBinaryType(declaredType)) {
    return formatBinary(utf8Encoder.encode(value));
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return "Invalid Date";
    const iso = value.toISOString();
    return declaredType?.toUpperCase() === "DATE" ? iso.slice(0, 10) : iso;
  }
  // Nested values can contain bytes and bigint too; JSON.stringify alone would turn the
  // former into a numeric-key object and throw on the latter.
  if (Array.isArray(value) || (typeof value === "object" && value !== null)) {
    try {
      return (
        JSON.stringify(value, (_key, item: unknown) => {
          if (item instanceof Uint8Array) return formatNestedBytes(item);
          if (item instanceof ArrayBuffer) return formatNestedBytes(new Uint8Array(item));
          if (typeof item === "bigint") return item.toString();
          return item;
        }) ?? ""
      );
    } catch {
      // fall through to the generic display helper for cyclic structures
    }
  }
  return toDisplayText(value);
}
