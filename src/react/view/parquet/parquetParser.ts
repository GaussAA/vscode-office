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
 * The only place a parquet type string is decoded.
 *
 * The viewer asks one question about a column: which icon and alignment it gets. Each caller
 * used to do its own `type.includes(...)` scan, in a different order, so a new logical type had
 * to be taught to several functions and the answers could disagree (a `LIST<STRING>` looked
 * like a string).
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

function asyncBufferFromArrayBuffer(buffer: ArrayBuffer): AsyncBuffer {
  return {
    byteLength: buffer.byteLength,
    slice(start: number, end?: number) {
      return buffer.slice(start, end ?? buffer.byteLength);
    },
  };
}

function formatSchemaType(element: SchemaElement): string {
  if (element.logical_type?.type) {
    return element.logical_type.type;
  }
  if (element.converted_type) {
    return element.converted_type;
  }
  return element.type ?? "UNKNOWN";
}

/**
 * Display type for a top-level column. `hasChildren` is authoritative for groups: a LIST
 * or MAP group may carry only `logical_type` (converted_type is deprecated), a plain
 * STRUCT carries neither, and none of them has a physical `element.type`.
 */
function formatColumnType(element: SchemaElement, hasChildren: boolean): string {
  if (hasChildren) {
    return element.converted_type ?? element.logical_type?.type ?? "STRUCT";
  }
  return formatSchemaType(element);
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
  return { name: element.name, type, category, nested };
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
