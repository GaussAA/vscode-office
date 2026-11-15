/**
 * Parquet schema utilities and column analysis.
 *
 * Core type categorization and column description logic, shared between
 * the webview parser and the service-layer profile.
 *
 * @module parquetSchema
 */

import type { AsyncBuffer, SchemaElement } from "hyparquet";
import type { ByteSource } from "@/service/jsonlFile";

export type { SchemaElement };

export type ColumnCategory = "bool" | "numeric" | "string" | "datetime" | "structure" | "field";

/**
 * Categorize a Parquet column type for display purposes.
 *
 * This is the single source of truth for type classification.
 * Each column gets an icon and alignment based on its category.
 *
 * Categories:
 * - bool: Boolean values
 * - numeric: Integers, floats, decimals
 * - string: Text, UUIDs, enums, bytes
 * - datetime: Timestamps, dates, times
 * - structure: JSON, structs, maps, lists
 * - field: Unknown/fallback types
 *
 * @param type - Raw Parquet type string (e.g., "INT64", "UTF8", "TIMESTAMP_MILLIS")
 * @returns The display category
 * @example
 * ```ts
 * categorizeType("INT64") // "numeric"
 * categorizeType("UTF8") // "string"
 * categorizeType("TIMESTAMP_MILLIS") // "datetime"
 * categorizeType("LIST<STRING>") // "structure"
 * ```
 */
export function categorizeType(type: string): ColumnCategory {
  const upper = `${type}`.toUpperCase();
  if (upper.includes("BOOL")) return "bool";
  if (
    upper.includes("JSON") ||
    upper.includes("STRUCT") ||
    upper.includes("MAP") ||
    upper.includes("LIST")
  ) {
    return "structure";
  }
  if (upper.includes("TIMESTAMP") || upper.includes("DATE") || upper.includes("TIME"))
    return "datetime";
  // ENUM contains NUM; keep it string-like before the numeric fallback below.
  if (upper.includes("UUID") || upper.includes("ENUM")) return "string";
  if (
    upper.includes("INT") ||
    upper.includes("FLOAT") ||
    upper.includes("DOUBLE") ||
    upper.includes("DECIMAL") ||
    upper.includes("NUM")
  ) {
    return "numeric";
  }
  if (
    upper.includes("STRING") ||
    upper.includes("UTF8") ||
    upper.includes("BYTE") ||
    upper.includes("CHAR")
  ) {
    return "string";
  }
  return "field";
}

export interface ColumnDescription {
  name: string;
  /** Raw schema type, shown next to the name. */
  type: string;
  /** Derived once, so the icon and alignment cannot disagree. */
  category: ColumnCategory;
  /** Groups and legacy repeated primitives are one cell of JSON, not a scalar. */
  nested: boolean;
}

/**
 * Format a schema element's type for display.
 *
 * Prefers logical_type over deprecated converted_type, with fallback to physical type.
 * Normalizes UTF8 to STRING for consistency.
 *
 * @param element - Parquet schema element
 * @returns Formatted type string (e.g., "STRING", "INT64", "TIMESTAMP_MILLIS")
 */
function formatSchemaType(element: SchemaElement): string {
  let type: string;
  if (element.logical_type?.type) {
    type = element.logical_type.type;
  } else if (element.converted_type) {
    type = element.converted_type;
  } else {
    type = element.type ?? "UNKNOWN";
  }
  // Normalize UTF8 to STRING for consistent display (UTF8 is the default encoding)
  if (type.toUpperCase() === "UTF8") {
    return "STRING";
  }
  return type;
}

/**
 * Format a top-level column's type for display.
 *
 * Handles both leaf columns and nested structures (LIST, MAP, STRUCT).
 * For groups, uses logical_type or converted_type; for leaves, uses formatSchemaType.
 *
 * @param element - Schema element
 * @param hasChildren - True if this is a group with nested elements
 * @returns Formatted type string (e.g., "LIST", "MAP", "STRUCT", "INT64")
 */
function formatColumnType(element: SchemaElement, hasChildren: boolean): string {
  let type: string;
  if (hasChildren) {
    type = element.converted_type ?? element.logical_type?.type ?? "STRUCT";
  } else {
    type = formatSchemaType(element);
  }
  // Normalize UTF8 to STRING for consistent display (UTF8 is the default encoding)
  if (type.toUpperCase() === "UTF8") {
    return "STRING";
  }
  return type;
}

/**
 * Build the column model from one top-level schema element.
 *
 * Exported for unit tests: a hand-built SchemaElement is the only way to cover a
 * logical-type-only LIST without committing a second binary fixture.
 */
export function describeColumn(element: SchemaElement, hasChildren: boolean): ColumnDescription {
  const nested = hasChildren || element.repetition_type === "REPEATED";
  const type = formatColumnType(element, hasChildren);
  // A nested column is one cell of JSON, so it gets the structure icon and alignment.
  const category = nested ? "structure" : categorizeType(type);

  return {
    name: element.name,
    type,
    category,
    nested,
  };
}

/**
 * Convert an ArrayBuffer to AsyncBuffer for hyparquet.
 *
 * AsyncBuffer is hyparquet's abstraction for file access that works
 * with both local buffers and remote files.
 *
 * @param buffer - The array buffer to wrap
 * @returns AsyncBuffer interface for hyparquet
 */
export function asyncBufferFrom(buffer: ArrayBuffer): AsyncBuffer;
/**
 * Convert a ByteSource to AsyncBuffer for hyparquet.
 *
 * Takes a byte source with async read capability and adapts it to hyparquet's
 * AsyncBuffer interface. Used by the service layer to read parquet files
 * without loading them entirely into memory.
 *
 * @param source - The byte source to wrap
 * @returns AsyncBuffer interface for hyparquet
 */
export function asyncBufferFrom(source: ByteSource): AsyncBuffer;
export function asyncBufferFrom(input: ArrayBuffer | ByteSource): AsyncBuffer {
  if (input instanceof ArrayBuffer) {
    return {
      byteLength: input.byteLength,
      slice(start: number, end?: number) {
        return input.slice(start, end ?? input.byteLength);
      },
    };
  }
  // ByteSource case
  const source = input;
  return {
    byteLength: source.size,
    async slice(start: number, end?: number): Promise<ArrayBuffer> {
      const from = Math.max(0, Math.min(start, source.size));
      const to = Math.max(from, Math.min(end ?? source.size, source.size));
      if (to <= from) return new ArrayBuffer(0);
      const bytes = await source.read(from, to - from);
      // `read` may return a view over a larger buffer; hyparquet wants exactly these bytes.
      const exact = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      return exact as ArrayBuffer;
    },
  };
}
