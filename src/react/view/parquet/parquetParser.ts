/**
 * Parquet File Parsing and Schema Analysis
 *
 * Core parser for Apache Parquet files using the hyparquet library.
 * Handles metadata extraction, schema parsing, column categorization,
 * and data reading with support for various compression codecs.
 *
 * Key features:
 * - Schema tree flattening for display
 * - Column type categorization (bool, numeric, string, datetime, structure)
 * - Compression codec support (ZSTD, GZIP, BROTLI, LZ4, SNAPPY)
 * - Nested structure handling
 *
 * @module parquetParser
 */

import {
  parquetMetadataAsync,
  parquetReadObjects,
  parquetSchema,
  type AsyncBuffer,
  type FileMetaData,
  type SchemaElement,
} from "hyparquet";
// Fork addition: decode ZSTD/GZIP/BROTLI/LZ4 columns (upstream shipped SNAPPY only).
import { compressors } from "hyparquet-compressors";
import { toDisplayText } from "@/common/displayText";

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

export interface ParquetColumnInfo {
  name: string;
  /** Raw schema type, shown next to the name. */
  type: string;
  /** Display type, with special handling for URL-like columns. */
  displayType?: string;
  /** Derived once, so the icon and alignment cannot disagree. */
  category: ColumnCategory;
  /** Groups and legacy repeated primitives are one cell of JSON, not a scalar. */
  nested: boolean;
}

export interface ParquetFileInfo {
  file: AsyncBuffer;
  metadata: FileMetaData;
  columns: ParquetColumnInfo[];
  rowCount: number;
  createdBy?: string;
}

/** Rows per page in the webview table. Shared so paging and row addressing agree. */
export const PARQUET_PAGE_SIZE = 50;
/**
 * Rows read per source call.
 *
 * A parquet data page costs the same to decode whether one row or twenty thousand are asked for
 * — measured on a 202 MB / 1.1 M row / 49 column file: 50 rows and 20,000 rows both read 22.6 MB
 * and took ~1.4 s. Page-sized reads therefore paid the full price on every turn; a chunk pays it
 * once per hundred pages.
 */
export const PARQUET_CHUNK_SIZE = 5_000;

/**
 * Convert an ArrayBuffer to AsyncBuffer for hyparquet.
 *
 * AsyncBuffer is hyparquet's abstraction for file access that works
 * with both local buffers and remote files.
 *
 * @param buffer - The array buffer to wrap
 * @returns AsyncBuffer interface for hyparquet
 */
function asyncBufferFromArrayBuffer(buffer: ArrayBuffer): AsyncBuffer {
  return {
    byteLength: buffer.byteLength,
    slice(start: number, end?: number) {
      return buffer.slice(start, end ?? buffer.byteLength);
    },
  };
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
export function describeColumn(element: SchemaElement, hasChildren: boolean): ParquetColumnInfo {
  const nested = hasChildren || element.repetition_type === "REPEATED";
  const type = formatColumnType(element, hasChildren);
  // A nested column is one cell of JSON, so it gets the structure icon and alignment.
  const category = nested ? "structure" : categorizeType(type);

  // Detect URL-like columns by name pattern (case-insensitive)
  const name = element.name.toLowerCase();
  const isLikelyUrl =
    !nested &&
    category === "string" &&
    (name.includes("url") ||
      name.includes("link") ||
      name.includes("href") ||
      name === "uri" ||
      name.endsWith("_url") ||
      name.endsWith("_link") ||
      name.startsWith("url_") ||
      name.startsWith("link_"));

  return {
    name: element.name,
    type,
    displayType: isLikelyUrl ? "link" : undefined,
    category,
    nested,
  };
}

function isAsyncBuffer(source: ArrayBuffer | AsyncBuffer): source is AsyncBuffer {
  const candidate = source as AsyncBuffer;
  return typeof candidate?.slice === "function" && typeof candidate?.byteLength === "number";
}

export async function openParquetFile(
  source: ArrayBuffer | AsyncBuffer,
  options: {
    /**
     * Bytes hyparquet may pull from the tail before it knows how big the footer is.
     *
     * The default (512 KB) is a latency trade: one request, slightly too many bytes. The
     * profile gate is a byte-count invariant, so it asks for the 8-byte footer magic instead
     * and lets the second, exact-sized read fetch the metadata.
     */
    initialFetchSize?: number;
  } = {},
): Promise<ParquetFileInfo> {
  const file = isAsyncBuffer(source) ? source : asyncBufferFromArrayBuffer(source);
  const metadata = await parquetMetadataAsync(file, {
    initialFetchSize: options.initialFetchSize,
  });
  const schemaTree = parquetSchema(metadata);
  // Top-level columns only. `getPhysicalColumns` returns leaf paths, so a LIST column
  // named `tags` came out as three "columns" (`tags.list.element`…), while the row
  // objects are keyed by the top-level name — the lookup missed and rendered NULL.
  const columns: ParquetColumnInfo[] = schemaTree.children.map((child) =>
    describeColumn(child.element, child.children.length > 0),
  );
  return {
    file,
    metadata,
    columns,
    rowCount: Number(metadata.num_rows),
    createdBy: metadata.created_by,
  };
}

/** Read a row range only — the table pages through big files with this. */
export async function readParquetRows(
  file: AsyncBuffer,
  metadata: FileMetaData,
  start: number,
  end: number,
  options: { utf8?: boolean } = {},
): Promise<Record<string, unknown>[]> {
  const rowCount = Number(metadata.num_rows);
  const from = Math.max(0, Math.min(start, rowCount));
  const to = Math.max(from, Math.min(end, rowCount));
  if (to <= from) {
    return [];
  }
  return parquetReadObjects({
    file,
    metadata,
    rowStart: from,
    rowEnd: to,
    rowFormat: "object",
    // The table needs the raw bytes to distinguish a text column from a binary one.
    // Callers that only need display strings keep hyparquet's default UTF-8 decoding.
    utf8: options.utf8 ?? true,
    compressors,
  });
}

/** A binary cell is bytes; a JSON object of control characters is not a value. */
const BINARY_PREVIEW_BYTES = 24;

function formatBinary(bytes: Uint8Array): string {
  if (bytes.byteLength === 0) return "0 B";
  const preview = Array.from(bytes.subarray(0, BINARY_PREVIEW_BYTES), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join(" ");
  return `0x${preview}${bytes.byteLength > BINARY_PREVIEW_BYTES ? ` … (${bytes.byteLength} B)` : ""}`;
}

function isBinaryType(type: string): boolean {
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
