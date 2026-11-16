import { RequestGuard } from "../../util/requestGuard.ts";

/**
 * Guard for async cell loading: "select A → read A → select B → A's result must not overwrite B".
 *
 * Each cell selection issues a request id. When the async read completes, the view checks whether
 * the result still matches the current selection (both the request id and the cell position).
 */
export class CellLoadGuard {
  private readonly guard = new RequestGuard();

  /** Issue a request for a cell selection. Returns the request id. */
  issueLoad(row: number, col: number): { id: number; row: number; col: number } {
    return { id: this.guard.issue(), row, col };
  }

  /**
   * Check whether the loaded value should be applied. Returns true only when the result is for
   * the current selection (same id, same position).
   */
  shouldApply(
    requested: { id: number; row: number; col: number },
    current: { row: number; col: number } | null,
  ): boolean {
    if (!current) return false;
    if (!this.guard.isCurrent(requested.id)) return false;
    return requested.row === current.row && requested.col === current.col;
  }

  /** Cancel the current request (new selection, document change, unmount). */
  cancel(): void {
    this.guard.cancel();
  }
}
