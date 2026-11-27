import { savePersistedState } from "../../common/persistedState.ts";
import { COLUMN_MAX_WIDTH, COLUMN_MIN_WIDTH, COLUMN_WIDTH_STORAGE_KEY } from "./parquetLayout";

/**
 * Per-file UI state: column widths, the current row, and the schema field filter.
 *
 * The row used to live under `parquet-state:` keyed by the per-session webview path, while
 * column widths were one global map shared by every file. Both were wrong in opposite
 * directions: the row could miss after a webview re-keyed the document, and a width set on one
 * file leaked into every other file. This cache keys everything by `documentCacheId` and keeps
 * the shared sidebar width out of it (a layout preference, not a document fact).
 *
 * The disk cache follows ADR-0025: 90 days, LRU 20 documents, read-merge-write so two tabs
 * editing different fields do not erase each other. A legacy global width map is only a first
 * read fallback; a per-file entry that explicitly has `{}` wins (the user reset every width).
 */
export const PARQUET_UI_PREFIX = "parquet-ui:";
const UI_VERSION = 1;
/** Layout is cheap and useful for a long time; the row/filter save refreshes this anyway. */
const UI_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

export interface ParquetUiState {
  /** Column name → width. Absent means "use the legacy global widths or the default". */
  columnWidths?: Record<string, number>;
  row?: number;
  fieldFilter?: string;
  /** Which columns the next search walks; `active` needs a selected field. */
  searchScope?: "all" | "active" | "visible";
  /** Absolute column positions checked in the schema rail. */
  selectedColumns?: number[];
  /** Whether the table shows only `selectedColumns`. */
  showOnlySelected?: boolean;
}

export type ParquetUiPatch = ParquetUiState;

interface StoredParquetUi extends ParquetUiState {
  v: number;
  /** Written by `savePersistedState`; used for the TTL and the LRU order. */
  ts?: number;
}

/** Accept only widths the drag handle can produce; a corrupt entry must not break layout. */
export function parseColumnWidths(raw: string | null): Record<string, number> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const clean: Record<string, number> = {};
    for (const [name, width] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof width === "number" && width >= COLUMN_MIN_WIDTH && width <= COLUMN_MAX_WIDTH) {
        clean[name] = width;
      }
    }
    return clean;
  } catch {
    return {};
  }
}

/** The pre-ADR-0025 global width map, read once as a fallback for existing layouts. */
export function legacyColumnWidths(): Record<string, number> {
  try {
    return parseColumnWidths(localStorage.getItem(COLUMN_WIDTH_STORAGE_KEY));
  } catch {
    return {};
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** The per-file UI state, or null when there is no valid entry for this document. */
export function loadParquetUi(key: string | undefined): ParquetUiState | null {
  if (!key) return null;
  const storageKey = PARQUET_UI_PREFIX + key;
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredParquetUi>;
    const fresh = typeof parsed.ts === "number" && Date.now() - parsed.ts <= UI_MAX_AGE_MS;
    if (parsed.v !== UI_VERSION || !fresh) {
      localStorage.removeItem(storageKey);
      return null;
    }
    const state: ParquetUiState = {};
    if (isPlainObject(parsed.columnWidths)) {
      // Re-validate through the same parser the drag handle uses: the stored map is untrusted.
      state.columnWidths = parseColumnWidths(JSON.stringify(parsed.columnWidths));
    }
    if (typeof parsed.row === "number" && Number.isFinite(parsed.row) && parsed.row >= 0) {
      state.row = Math.floor(parsed.row);
    }
    if (typeof parsed.fieldFilter === "string") state.fieldFilter = parsed.fieldFilter;
    if (
      parsed.searchScope === "all" ||
      parsed.searchScope === "active" ||
      parsed.searchScope === "visible"
    ) {
      state.searchScope = parsed.searchScope;
    }
    if (Array.isArray(parsed.selectedColumns)) {
      state.selectedColumns = [
        ...new Set(
          parsed.selectedColumns.filter(
            (position): position is number =>
              typeof position === "number" && Number.isInteger(position) && position >= 0,
          ),
        ),
      ].sort((left, right) => left - right);
    }
    if (typeof parsed.showOnlySelected === "boolean") {
      state.showOnlySelected = parsed.showOnlySelected;
    }
    return state;
  } catch {
    // A corrupt blob cannot describe a layout; remove it so the next open starts clean.
    try {
      localStorage.removeItem(storageKey);
    } catch {}
    return null;
  }
}

/**
 * Merge one patch into the document's UI state.
 *
 * `columnWidths` is a field: the caller passes the whole map (the hook owns it), so the newest
 * map wins. `row` and `fieldFilter` are independent fields and survive each other's writes.
 */
export function saveParquetUi(key: string | undefined, patch: ParquetUiPatch): void {
  if (!key) return;
  const current = loadParquetUi(key) ?? {};
  const next: ParquetUiState = { ...current };
  if (patch.columnWidths !== undefined) next.columnWidths = patch.columnWidths;
  if (patch.row !== undefined && Number.isFinite(patch.row) && patch.row >= 0) {
    next.row = Math.floor(patch.row);
  }
  if (patch.fieldFilter !== undefined) next.fieldFilter = patch.fieldFilter;
  if (patch.searchScope !== undefined) next.searchScope = patch.searchScope;
  if (patch.selectedColumns !== undefined) next.selectedColumns = patch.selectedColumns;
  if (patch.showOnlySelected !== undefined) next.showOnlySelected = patch.showOnlySelected;
  savePersistedState(PARQUET_UI_PREFIX, key, { v: UI_VERSION, ...next });
}

/** Remove every per-file UI entry; used by the Clear cache command and its tests. */
export function clearParquetUiStorage(): void {
  try {
    const keys: string[] = [];
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (key?.startsWith(PARQUET_UI_PREFIX)) keys.push(key);
    }
    for (const key of keys) localStorage.removeItem(key);
  } catch {}
}
