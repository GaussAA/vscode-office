/**
 * The result of one whole-file search: which rows matched, in which column, and which text the
 * result belongs to. No React, no DOM, so `node --test` can drive it.
 *
 * Page arithmetic is not done here. The caller passes anything shaped like `ParquetSession`
 * (`pageToRow`, `endOf`, `rowToPage`), which is the one place that owns `row <-> page`.
 *
 * @module parquetHitSet
 */

/** The slice of `ParquetSession` that navigation needs. */
export interface PageGeometry {
  /** First row of `page`. */
  pageToRow(page: number): number;
  /** Exclusive end row of `page`. */
  endOf(page: number): number;
}

export interface HitMatch {
  /** The matching row, 0-based. */
  row: number;
  /** Column index of the first value in that row that matched. */
  column: number;
  /** Position of this match in the ascending hit list. */
  index: number;
}

/** The text a search ran for, as the search normalises it. */
export function normalizeSearchQuery(text: string): string {
  return text.trim().toLowerCase();
}

/**
 * An immutable, ascending list of hits.
 *
 * The rows are ordered once, at construction. Every later step is a binary search, so stepping
 * through 5,000 hits does not re-sort 5,000 rows per key press.
 */
export class ParquetHitSet {
  private readonly rows: readonly number[];
  private readonly columns: readonly number[];
  private readonly query: string;
  private rowLookup: Set<number> | undefined;

  /**
   * @param rows Matching rows. Search returns them ascending; anything else is ordered here.
   * @param columns Column per row, parallel to `rows`.
   * @param query The normalised text these hits belong to.
   */
  constructor(rows: readonly number[], columns: readonly number[], query: string) {
    const ascending = rows.every((row, at) => at === 0 || rows[at - 1] < row);
    if (ascending) {
      this.rows = [...rows];
      this.columns = rows.map((_row, at) => columns[at] ?? 0);
    } else {
      const order = rows
        .map((row, at) => ({ row, column: columns[at] ?? 0 }))
        .sort((left, right) => left.row - right.row)
        .filter((entry, at, all) => at === 0 || all[at - 1].row !== entry.row);
      this.rows = order.map((entry) => entry.row);
      this.columns = order.map((entry) => entry.column);
    }
    this.query = query;
  }

  get size(): number {
    return this.rows.length;
  }

  get isEmpty(): boolean {
    return this.rows.length === 0;
  }

  /** Every hit row, for row highlighting. The same Set each time. */
  get rowSet(): Set<number> {
    this.rowLookup ??= new Set(this.rows);
    return this.rowLookup;
  }

  /** True when these hits answer `text`, i.e. it normalises to the text that was searched. */
  isFor(text: string): boolean {
    return this.query === normalizeSearchQuery(text);
  }

  /** The hit at `index`, or undefined when out of range. */
  at(index: number): HitMatch | undefined {
    if (!Number.isInteger(index) || index < 0 || index >= this.rows.length) return undefined;
    return { row: this.rows[index], column: this.columns[index], index };
  }

  /**
   * The next (`1`) or previous (`-1`) hit relative to the page on screen, wrapping at the ends.
   *
   * Forward is the first hit at or after the end of the page; backward is the last hit before
   * its start. Hits on the page itself are skipped, so each press leaves the page.
   * Null only when there are no hits.
   */
  step(direction: 1 | -1, page: number, geometry: PageGeometry): HitMatch | null {
    if (this.rows.length === 0) return null;
    if (direction > 0) {
      const next = this.firstAtOrAfter(geometry.endOf(page));
      return this.at(next < this.rows.length ? next : 0) ?? null;
    }
    const previous = this.firstAtOrAfter(geometry.pageToRow(page)) - 1;
    return this.at(previous >= 0 ? previous : this.rows.length - 1) ?? null;
  }

  /** Index of the first hit whose row is >= `row`; `size` when there is none. */
  private firstAtOrAfter(row: number): number {
    let low = 0;
    let high = this.rows.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (this.rows[middle] < row) low = middle + 1;
      else high = middle;
    }
    return low;
  }
}
