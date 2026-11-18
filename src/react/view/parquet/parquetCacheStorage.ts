import { COLUMN_WIDTH_STORAGE_KEY, SIDER_STORAGE_KEY } from "./parquetLayout";
import { PARQUET_ROW_PREFIX } from "./parquetPersistence";
import { PARQUET_SHARES_PREFIX } from "./parquetShareCache";
import { PARQUET_UI_PREFIX } from "./parquetUiState";

/**
 * Every localStorage key the parquet viewer derives from a document.
 *
 * Clear cache removes all of them together: a command that left the old row or the legacy
 * global widths behind would restore exactly what the user asked to forget. JSONL and Excel
 * keys are deliberately not here.
 */
const PARQUET_CACHE_KEYS = new Set([COLUMN_WIDTH_STORAGE_KEY, SIDER_STORAGE_KEY]);
const PARQUET_CACHE_PREFIXES = [PARQUET_SHARES_PREFIX, PARQUET_UI_PREFIX, PARQUET_ROW_PREFIX];

/** Remove all parquet-derived localStorage; safe when storage is unavailable. */
export function clearParquetLocalCaches(): void {
  try {
    const keys: string[] = [];
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (
        key &&
        (PARQUET_CACHE_KEYS.has(key) ||
          PARQUET_CACHE_PREFIXES.some((prefix) => key.startsWith(prefix)))
      ) {
        keys.push(key);
      }
    }
    for (const key of keys) localStorage.removeItem(key);
  } catch {}
}
