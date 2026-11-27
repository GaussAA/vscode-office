/**
 * Test harness adapter for the host-side parquet search.
 *
 * The UI and performance harnesses serve fixture files over HTTP, while the search now runs
 * in the extension host over a real byte source. This module is bundled with esbuild so the
 * fake host can answer a search request from the same service the extension uses, instead of
 * reimplementing the scan in the page.
 */
import { readFileSync } from "node:fs";
import { openParquetFile } from "@/common/parquetReader";
import { searchParquetValues } from "@/service/parquetSearch";

export interface HarnessSearchResult {
  rows: number[] | null;
  columns: number[];
  rowCount: number;
  capped: boolean;
  scanned: number;
  error?: string;
}

export async function searchFixture(
  path: string,
  query: string,
  columns?: number[],
): Promise<HarnessSearchResult> {
  try {
    const bytes = readFileSync(path);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const info = await openParquetFile(buffer);
    const result = await searchParquetValues(info, query, { columns });
    return {
      rows: result.rows,
      columns: result.columns,
      rowCount: info.rowCount,
      capped: result.capped,
      scanned: result.scanned,
    };
  } catch (error) {
    return {
      rows: null,
      columns: [],
      rowCount: 0,
      capped: false,
      scanned: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
