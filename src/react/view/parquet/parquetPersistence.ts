/**
 * Legacy row restore, read once while the per-file UI state migrates.
 *
 * Rows used to be persisted by the webview path (`parquet-state:<path>`); that key is only
 * session-stable, so a re-keyed webview could miss it. ADR-0025 moves the row into
 * `parquet-ui:<documentCacheId>`; this reader stays so the first open after the upgrade can
 * adopt the old position instead of jumping to the top. Writes go through `parquetUiState`.
 */
const PERSIST_PREFIX = "parquet-state:";
/** Exported for Clear cache: the legacy rows are parquet state too. */
export const PARQUET_ROW_PREFIX = PERSIST_PREFIX;

export function loadPersistedRow(key: string | undefined): number {
  if (!key) return 0;
  try {
    const raw = localStorage.getItem(PERSIST_PREFIX + key);
    if (!raw) return 0;
    // `row` since 6.4.1. Older entries (only `page`) are ignored rather than misread as rows.
    const parsed = JSON.parse(raw) as { row?: number };
    return typeof parsed.row === "number" && parsed.row >= 0 ? parsed.row : 0;
  } catch {
    return 0;
  }
}
