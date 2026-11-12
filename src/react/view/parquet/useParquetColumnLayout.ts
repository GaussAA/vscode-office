import { useCallback, useEffect, useMemo, useState } from "react";
import type { ParquetColumnInfo } from "./parquetParser";
import {
  COLUMN_MAX_WIDTH,
  COLUMN_MIN_WIDTH,
  COLUMN_WIDTH_STORAGE_KEY,
  DATA_COLUMN_WIDTH,
} from "./parquetLayout";
import { computeParquetColumnLayout } from "./parquetColumnLayout";

export function parseStoredColumnWidths(raw: string | null): Record<string, number> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
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

/**
 * Owns persisted per-column widths and the stretched layout derived from them. Columns are keyed
 * by name so a width survives page turns and a schema change keeps the columns it still has.
 */
export function useParquetColumnLayout(columns: ParquetColumnInfo[], tableBodyWidth: number) {
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => {
    try {
      return parseStoredColumnWidths(localStorage.getItem(COLUMN_WIDTH_STORAGE_KEY));
    } catch {
      return {};
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(COLUMN_WIDTH_STORAGE_KEY, JSON.stringify(columnWidths));
    } catch {}
  }, [columnWidths]);

  const layout = useMemo(() => {
    const widths = columns.map((column) => columnWidths[column.name] ?? DATA_COLUMN_WIDTH);
    return computeParquetColumnLayout(widths, tableBodyWidth);
  }, [columnWidths, columns, tableBodyWidth]);

  const setColumnWidth = useCallback((name: string, width: number) => {
    setColumnWidths((current) => ({ ...current, [name]: width }));
  }, []);

  const resetColumnWidth = useCallback((name: string) => {
    setColumnWidths((current) => {
      const next = { ...current };
      delete next[name];
      return next;
    });
  }, []);

  return { layout, setColumnWidth, resetColumnWidth };
}
