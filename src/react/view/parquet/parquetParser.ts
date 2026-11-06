import {
  parquetMetadataAsync,
  parquetReadObjects,
  parquetSchema,
  type AsyncBuffer,
  type FileMetaData,
  type SchemaElement,
  type SchemaTree,
} from "hyparquet";
import { getPhysicalColumns } from "hyparquet/src/schema.js";
import { parquetWriteBuffer, type BasicType, type ColumnSource } from "hyparquet-writer";
// Fork addition: decode ZSTD/GZIP/BROTLI/LZ4 columns (upstream shipped SNAPPY only).
import { compressors } from "hyparquet-compressors";

export type ColumnCategory = "bool" | "numeric" | "string" | "datetime" | "structure" | "field";

/**
 * The only place a parquet type string is decoded.
 *
 * The viewer needs three answers about a column — which icon and alignment it gets, whether a
 * cell may be edited, and how typed input is parsed back. Each used to do its own
 * `type.includes(...)` scan, in a different order, so a new logical type had to be taught to
 * three functions and the answers could disagree (a `LIST<STRING>` looked like a string).
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
  /** Raw schema type, shown next to the name and used to parse typed input. */
  type: string;
  /** Derived once, so the icon, alignment and editability cannot disagree. */
  category: ColumnCategory;
  editable: boolean;
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

function findLeafElement(tree: SchemaTree, pathParts: string[]): SchemaElement | null {
  if (pathParts.length == 0) {
    return tree.element.type ? tree.element : null;
  }
  const [head, ...rest] = pathParts;
  for (const child of tree.children) {
    if (child.element.name == head) {
      return findLeafElement(child, rest);
    }
  }
  return null;
}

function isAsyncBuffer(source: ArrayBuffer | AsyncBuffer): source is AsyncBuffer {
  const candidate = source as AsyncBuffer;
  return typeof candidate?.slice === "function" && typeof candidate?.byteLength === "number";
}

export async function openParquetFile(source: ArrayBuffer | AsyncBuffer): Promise<ParquetFileInfo> {
  const file = isAsyncBuffer(source) ? source : asyncBufferFromArrayBuffer(source);
  const metadata = await parquetMetadataAsync(file);
  const schemaTree = parquetSchema(metadata);
  const columnNames = getPhysicalColumns(schemaTree);
  const columns: ParquetColumnInfo[] = [];
  for (const name of columnNames) {
    const element = findLeafElement(schemaTree, name.split("."));
    const type = element ? formatSchemaType(element) : "UNKNOWN";
    const category = categorizeType(type);
    columns.push({
      name,
      type,
      category,
      editable: category !== "structure",
    });
  }
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

function inferColumnType(values: unknown[]): BasicType {
  let hasFloat = false;
  let hasBigInt = false;
  let hasDate = false;
  let hasBoolean = false;
  let hasNumber = false;
  let nonNullCount = 0;

  for (const value of values) {
    if (value == null) continue;
    nonNullCount++;
    if (typeof value === "boolean") {
      hasBoolean = true;
      continue;
    }
    if (typeof value === "bigint") {
      hasBigInt = true;
      continue;
    }
    if (value instanceof Date) {
      hasDate = true;
      continue;
    }
    if (typeof value === "number") {
      hasNumber = true;
      if (!Number.isInteger(value)) hasFloat = true;
      continue;
    }
    return "STRING";
  }

  if (nonNullCount == 0) return "STRING";
  if (hasBoolean && !hasNumber && !hasBigInt && !hasDate) return "BOOLEAN";
  if (hasDate && !hasNumber && !hasBigInt && !hasBoolean) return "TIMESTAMP";
  if (hasBigInt && !hasFloat && !hasDate && !hasBoolean) return "INT64";
  if (hasNumber && !hasFloat && !hasBigInt && !hasDate && !hasBoolean) return "INT32";
  if (hasNumber && !hasBigInt && !hasDate && !hasBoolean) return "DOUBLE";
  return "STRING";
}

function normalizeParquetValue(value: unknown, type: BasicType): unknown {
  if (value == null) return null;
  if (type == "STRING" || type == "JSON") {
    if (typeof value === "object") {
      if (value instanceof Date) return value.toISOString();
      return JSON.stringify(value);
    }
    return String(value);
  }
  if (type == "BOOLEAN") return Boolean(value);
  if (type == "TIMESTAMP") {
    if (value instanceof Date) return value;
    const date = new Date(value as string | number);
    return isNaN(date.getTime()) ? null : date;
  }
  if (type == "INT64") {
    if (typeof value === "bigint") return value;
    return BigInt(Math.trunc(Number(value)));
  }
  if (type == "INT32" || type == "FLOAT" || type == "DOUBLE") {
    const number = Number(value);
    return isNaN(number) ? null : number;
  }
  return String(value);
}

export function writeParquetBuffer(
  columns: ParquetColumnInfo[],
  rows: Record<string, unknown>[],
): ArrayBuffer {
  const columnData: ColumnSource[] = [];
  for (const column of columns) {
    const values = rows.map((row) => row[column.name]);
    const type = inferColumnType(values);
    const data = values.map((value) => normalizeParquetValue(value, type));
    columnData.push({
      name: column.name,
      data,
      type,
      nullable: true,
    });
  }
  return parquetWriteBuffer({ columnData });
}

export function isColumnEditable(type: string): boolean {
  return categorizeType(type) !== "structure";
}

export function parseCellInput(text: string, type: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const category = categorizeType(type);

  if (category === "bool") {
    if (/^(true|1|yes)$/i.test(trimmed)) return true;
    if (/^(false|0|no)$/i.test(trimmed)) return false;
    return trimmed;
  }
  if (category === "numeric") {
    const number = Number(trimmed);
    if (isNaN(number)) return trimmed;
    // INTERVAL also matches the numeric family but carries a fractional value.
    if (upper(type).includes("INT") && !upper(type).includes("INTERVAL")) return Math.trunc(number);
    return number;
  }
  if (category === "structure" || trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }
  return trimmed;
}

const upper = (type: string) => `${type}`.toUpperCase();

export function formatCellValue(value: unknown): string {
  if (value == null) {
    return "";
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}
