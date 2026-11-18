import { useCallback, useEffect, useMemo, useState } from "react";
import type { ParquetColumnInfo } from "@/common/parquetReader";
import { DATA_COLUMN_WIDTH } from "./parquetLayout";
import { computeParquetColumnLayout } from "./parquetColumnLayout";
import { legacyColumnWidths, loadParquetUi, saveParquetUi } from "./parquetUiState";

interface EditedWidths {
  key: string;
  /** The cache epoch the edit belongs to; a Clear cache makes stale edits invisible. */
  token: number;
  widths: Record<string, number>;
}

/**
 * Owns persisted per-column widths and the stretched layout derived from them.
 *
 * Widths are per document (ADR-0025), keyed by `documentCacheId`; the legacy global map is only
 * a fallback when this document has no saved map. The saved map is *derived* during render and
 * an edit is the only thing that starts a save, so switching documents cannot write the previous
 * document's widths under the new key. `resetToken` is bumped by Clear cache: it re-reads the
 * (now empty) store and hides edits made before the clear.
 */
export function useParquetColumnLayout(
  columns: ParquetColumnInfo[],
  tableBodyWidth: number,
  documentKey: string | undefined,
  resetToken = 0,
) {
  /** The latest edit for one document; null until the user actually resizes something. */
  const [edited, setEdited] = useState<EditedWidths | null>(null);

  // A localStorage read per document, not an effect: the layout must be right on the first
  // render after the key arrives. An explicit `{}` is a real answer (every width reset); only an
  // absent field falls back to the pre-ADR-0025 global map.
  const storedWidths = useMemo(() => {
    // The epoch is read only to invalidate this memo after Clear cache; the store itself is
    // the source of truth.
    void resetToken;
    if (!documentKey) return {};
    return loadParquetUi(documentKey)?.columnWidths ?? legacyColumnWidths();
  }, [documentKey, resetToken]);

  const columnWidths =
    edited && edited.key === documentKey && edited.token === resetToken
      ? edited.widths
      : storedWidths;

  useEffect(() => {
    // Only an edit is a write. Loading a document, switching away, or clearing must not save.
    if (!edited || edited.key !== documentKey || edited.token !== resetToken) return;
    saveParquetUi(edited.key, { columnWidths: edited.widths });
  }, [edited, documentKey, resetToken]);

  const layout = useMemo(() => {
    const widths = columns.map((column) => columnWidths[column.name] ?? DATA_COLUMN_WIDTH);
    return computeParquetColumnLayout(widths, tableBodyWidth);
  }, [columnWidths, columns, tableBodyWidth]);

  const setColumnWidth = useCallback(
    (name: string, width: number) => {
      if (!documentKey) return;
      setEdited((current) => {
        const base =
          current?.key === documentKey && current.token === resetToken
            ? current.widths
            : storedWidths;
        return { key: documentKey, token: resetToken, widths: { ...base, [name]: width } };
      });
    },
    [documentKey, resetToken, storedWidths],
  );

  const resetColumnWidth = useCallback(
    (name: string) => {
      if (!documentKey) return;
      setEdited((current) => {
        const base =
          current?.key === documentKey && current.token === resetToken
            ? current.widths
            : storedWidths;
        const next = { ...base };
        delete next[name];
        return { key: documentKey, token: resetToken, widths: next };
      });
    },
    [documentKey, resetToken, storedWidths],
  );

  return { layout, setColumnWidth, resetColumnWidth };
}
