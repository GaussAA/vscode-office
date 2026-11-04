/** Implementation: private to the package, unreachable from outside. */
export interface ColumnSummary {
  column: string;
  nullCount: number;
}

/**
 * The real work. Callers never see this: it lives a folder deeper than the
 * package's entry points, so the boundary rules make it unreachable.
 */
export function summarizeRows(
  rows: readonly Record<string, unknown>[]
): ColumnSummary[] {
  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
  return columns.map((column) => ({
    column,
    nullCount: rows.filter(
      (row) => row[column] === null || row[column] === undefined
    ).length,
  }));
}
