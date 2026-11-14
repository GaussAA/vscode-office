/**
 * Cell Inspector Management for Parquet Viewer
 *
 * Manages the inspector panel that shows detailed cell content.
 * Useful for large values, JSON structures, and nested data.
 *
 * @module useParquetInspector
 */

import { useCallback, useRef, useState } from "react";

/**
 * Represents a cell selected for detailed inspection.
 */
export interface InspectedCell {
  /** Zero-based row index */
  row: number;
  /** Column name */
  column: string;
  /** Cell value (can be any Parquet type) */
  value: unknown;
}

/**
 * Manages the cell inspector panel state.
 *
 * The inspector shows:
 * - Full cell value (for large values)
 * - JSON structure (for nested data)
 * - Copy functionality
 *
 * @returns Inspector state and control functions
 */
export function useParquetInspector() {
  const [inspected, setInspected] = useState<InspectedCell | null>(null);
  const [copied, setCopied] = useState(false);
  const inspectedCopyRef = useRef("");

  const inspect = useCallback((cell: InspectedCell | null) => {
    setInspected(cell);
    setCopied(false);
  }, []);

  const clearInspector = useCallback(() => {
    setInspected(null);
    setCopied(false);
  }, []);

  /**
   * Copy cell value to clipboard.
   *
   * Shows a temporary "copied" indicator for 2 seconds.
   *
   * @param text - The text to copy
   */
  const copyValue = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error("Failed to copy:", error);
    }
  }, []);

  const setInspectedCopyText = useCallback((text: string) => {
    inspectedCopyRef.current = text;
  }, []);

  return {
    inspected,
    copied,
    inspectedCopyRef,
    inspect,
    clearInspector,
    copyValue,
    setInspectedCopyText,
  };
}
