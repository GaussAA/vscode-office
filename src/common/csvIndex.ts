/**
 * Windowed CSV record index and the host <-> webview messages for its disk cache (ADR-0028).
 *
 * The index contains record start byte offsets and the widest field count; it never contains
 * cell values. The webview scans on a miss and stores the index in the extension host; a later
 * open asks for it before scanning again.
 */
export interface CsvRecordIndex {
  /** Byte offset of every record start, ascending; 4 bytes on disk. */
  starts: number[];
  /** Widest record's field count, counted during the same scan. */
  maxFields: number;
}

/**
 * Same filter as the source and the disk cache: a cached index must match the byte length and
 * be strictly increasing from 0. An empty file is the one allowed empty index.
 */
export function isUsableCsvIndex(
  index: CsvRecordIndex | null | undefined,
  size: number,
): index is CsvRecordIndex {
  if (!index || !Array.isArray(index.starts)) return false;
  if (!Number.isInteger(index.maxFields) || index.maxFields < 0) return false;
  if (index.starts.length === 0) return size === 0;
  if (size <= 0) return false;
  let previous = -1;
  for (const start of index.starts) {
    if (!Number.isInteger(start) || start <= previous || start >= size) return false;
    previous = start;
  }
  return index.starts[0] === 0;
}

export interface ExcelCsvIndexOpenRequest {
  requestId: number;
}

export interface ExcelCsvIndexMetaPayload {
  requestId: number;
  key?: string;
  starts?: number[];
  maxFields?: number;
  missing?: boolean;
}

export interface ExcelCsvIndexStoreRequest {
  starts: number[];
  maxFields: number;
}
