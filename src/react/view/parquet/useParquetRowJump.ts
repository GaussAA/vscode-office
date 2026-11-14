import { useCallback, useState } from "react";

/**
 * Manages row jump state for footer navigation.
 *
 * When user enters a row number in the footer:
 * 1. Store the target row
 * 2. Navigate to the page containing that row
 * 3. Highlight the target row
 * 4. Clear highlight on next navigation
 */
export function useParquetRowJump() {
  /** The row number user entered, displayed as highlighted until next navigation */
  const [targetRow, setTargetRow] = useState<number | null>(null);
  /** Pending input value in the jump textbox */
  const [rowJump, setRowJump] = useState("");

  const jumpToRow = useCallback(
    (pageSize: number, totalRows: number, onPageChange: (page: number) => void): boolean => {
      const target = Number.parseInt(rowJump, 10);
      if (Number.isNaN(target) || target < 1 || target > totalRows) {
        return false;
      }

      const targetPage = Math.floor((target - 1) / pageSize);
      setTargetRow(target - 1); // Convert to 0-based
      setRowJump("");
      onPageChange(targetPage);
      return true;
    },
    [rowJump],
  );

  const clearTargetRow = useCallback(() => {
    setTargetRow(null);
  }, []);

  const clearRowJump = useCallback(() => {
    setRowJump("");
  }, []);

  return {
    targetRow,
    rowJump,
    setTargetRow,
    setRowJump,
    jumpToRow,
    clearTargetRow,
    clearRowJump,
  };
}
