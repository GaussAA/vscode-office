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

export async function openParquetFile(source: ArrayBuffer | AsyncBuffer): Promise<ParquetFileInfo> {
  const file = isAsyncBuffer(source) ? source : asyncBufferFromArrayBuffer(source);
  const metadata = await parquetMetadataAsync(file);
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
    compressors,
  });
}

export function formatCellValue(value: unknown): string {
  return toDisplayText(value);
}
