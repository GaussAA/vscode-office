import { useCallback, useRef, useState } from "react";

export interface InspectedCell {
  row: number;
  column: string;
  value: unknown;
}

/**
 * Manages the cell inspector panel state.
 *
 * The inspector shows:
 * - Full cell value (for large values)
 * - JSON structure (for nested data)
 * - Copy functionality
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
