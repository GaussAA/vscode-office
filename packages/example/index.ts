// Entry point: a file at the package root IS the public interface.
//
// Keep entry points small and few-functioned. Add another root file (e.g.
// `stats.ts`) when you need another seam — do not re-export a whole subtree
// through one barrel index.
import { summarizeRows, type ColumnSummary } from "./lib/impl.ts";

export type { ColumnSummary };

/**
 * One function is the whole interface; the aggregation behind it is hidden.
 * Delete this package and its callers would have to re-implement the counting.
 */
export function summarizeTable(
  rows: readonly Record<string, unknown>[]
): ColumnSummary[] {
  return summarizeRows(rows);
}
