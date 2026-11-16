/**
 * Parquet file reading and schema analysis.
 *
 * Core parser for Apache Parquet files using the hyparquet library.
 * Handles metadata extraction, schema parsing, and row reading with
 * support for various compression codecs (ZSTD, GZIP, BROTLI, LZ4, SNAPPY).
 *
 * This module is shared between the webview and the host: the webview uses it for
 * table paging, and the host uses it for column profiling. Both can import from
 * `@/common` without circular dependencies.
 *
 * @module parquetReader
 */

import {
  parquetMetadataAsync,
  parquetReadObjects,
  parquetSchema,
  type AsyncBuffer,
  type FileMetaData,
} from "hyparquet";
// Fork addition: decode ZSTD/GZIP/BROTLI/LZ4 columns (upstream shipped SNAPPY only).
import { compressors } from "hyparquet-compressors";
import { asyncBufferFrom, describeColumn, type ColumnDescription } from "@/common/parquetSchema";

export interface ParquetColumnInfo extends ColumnDescription {
  // All fields inherited from ColumnDescription
}

export interface ParquetFileInfo {
  file: AsyncBuffer;
  metadata: FileMetaData;
  columns: ParquetColumnInfo[];
  rowCount: number;
  createdBy?: string;
}

/**
 * Rows read per source call.
 *
 * A parquet data page costs the same to decode whether one row or twenty thousand are asked for
 * — measured on a 202 MB / 1.1 M row / 49 column file: 50 rows and 20,000 rows both read 22.6 MB
 * and took ~1.4 s. Page-sized reads therefore paid the full price on every turn; a chunk pays it
 * once per hundred pages.
 */
export const PARQUET_CHUNK_SIZE = 5_000;

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
  const file = isAsyncBuffer(source) ? source : asyncBufferFrom(source);
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
