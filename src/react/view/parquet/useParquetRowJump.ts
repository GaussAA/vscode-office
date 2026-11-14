/**
 * Row Jump Navigation for Parquet Viewer
 *
 * Manages the footer's "jump to row" functionality, allowing users
 * to navigate directly to a specific row number.
 *
 * @module useParquetRowJump
 */

import { useCallback, useState } from "react";

/**
 * Manages row jump state for footer navigation.
 *
 * When user enters a row number in the footer:
 * 1. Store the target row
 * 2. Navigate to the page containing that row
 * 3. Highlight the target row
 * 4. Clear highlight on next navigation
 *
 * @returns Row jump state and control functions
 */
export function useParquetRowJump() {
  /** The row number user entered, displayed as highlighted until next navigation */
  const [targetRow, setTargetRow] = useState<number | null>(null);
  /** Pending input value in the jump textbox */
  const [rowJump, setRowJump] = useState("");

  /**
   * Jump to a specific row number.
   *
   * Validates the input and calculates which page contains the target row.
   *
   * @param pageSize - Number of rows per page
   * @param totalRows - Total number of rows in the file
   * @param onPageChange - Callback to navigate to the calculated page
   * @returns true if jump was successful, false if input was invalid
   * @example
   * ```ts
   * jumpToRow(100, 1000, setPage); // Jump to row 42 (page 0)
   * ```
   */
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
