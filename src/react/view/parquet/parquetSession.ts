/**
 * Parquet paging session: everything about "which rows are on screen and which bytes have
 * already been read" — with no React, no DOM and no hyparquet import, so it can be exercised
 * by `node --test` with a fake reader.
 *
 * The invariants this module owns (each one used to live in a comment inside the component,
 * where several call sites had to remember it separately):
 *
 *  1. Only the newest `showPage()` may land. A slower earlier load resolves as `stale`.
 *  2. A prefetch that started before `reset()` must never populate the new cache. The old
 *     component checked the sequence guard on the visible page but not on the prefetch, so a
 *     reload could serve the previous file's rows from the new file's cache.
 *  3. The cache is bounded (LRU-ish: oldest insertion wins), and revisiting a page costs no read.
 *  4. Page <-> row arithmetic lives here. Nothing else may do `page * pageSize` again.
 *
 * The viewer is read-only: there is no edit map, no patch and no save payload. Rows go straight
 * from the source to the table.
 */

export type ParquetRow = Record<string, unknown>;

export interface ParquetRowsSource {
  rowCount: number;
  readRows(start: number, end: number): Promise<ParquetRow[]>;
}

export interface ParquetSessionOptions {
  pageSize?: number;
  /** Pages kept in memory; the viewer prefetches one page ahead. */
  maxCachedPages?: number;
}

export interface PageSnapshot {
  page: number;
  /** First row of this page, 0-based. */
  start: number;
  /** Exclusive end row. */
  end: number;
  rows: ParquetRow[];
  /** True when a newer showPage() superseded this one; the caller must ignore it. */
  stale: boolean;
}

const DEFAULT_PAGE_SIZE = 50;
const DEFAULT_MAX_CACHED_PAGES = 6;

export class ParquetSession {
  readonly pageSize: number;
  readonly rowCount: number;
  readonly totalPages: number;

  private readonly source: ParquetRowsSource;
  private readonly maxCachedPages: number;
  private readonly cache = new Map<number, ParquetRow[]>();
  private readonly pending = new Map<number, Promise<ParquetRow[]>>();

  /** Bumped by reset(); in-flight work from an older generation is discarded. */
  private generation = 0;
  /** Bumped by showPage(); only the newest load may become `rows`. */
  private loadSeq = 0;

  private currentPage = 0;
  private currentRows: ParquetRow[] = [];

  constructor(source: ParquetRowsSource, options: ParquetSessionOptions = {}) {
    this.source = source;
    this.pageSize = Math.max(1, options.pageSize ?? DEFAULT_PAGE_SIZE);
    this.rowCount = Math.max(0, source.rowCount);
    this.totalPages = Math.max(1, Math.ceil(this.rowCount / this.pageSize));
    this.maxCachedPages = Math.max(1, options.maxCachedPages ?? DEFAULT_MAX_CACHED_PAGES);
  }

  get page(): number {
    return this.currentPage;
  }

  /** Rows of the current page. */
  get rows(): ParquetRow[] {
    return this.currentRows;
  }

  startOf(page: number): number {
    return page * this.pageSize;
  }

  pageOf(row: number): number {
    return Math.floor(row / this.pageSize);
  }

  clampPage(page: number): number {
    return Math.max(0, Math.min(this.totalPages - 1, page));
  }

  /** Load a page and make it current. Resolves `stale: true` when superseded. */
  async showPage(page: number): Promise<PageSnapshot> {
    const target = this.clampPage(page);
    const start = this.startOf(target);
    const end = Math.min(this.rowCount, start + this.pageSize);
    const seq = ++this.loadSeq;
    const generation = this.generation;

    const rows = await this.loadRaw(target, start, end);
    if (generation !== this.generation || seq !== this.loadSeq) {
      return { page: target, start, end, rows: [], stale: true };
    }

    this.currentPage = target;
    this.currentRows = rows;
    return { page: target, start, end, rows, stale: false };
  }

  /**
   * Warm the cache for `page` without waiting. Failures are swallowed: a prefetch is an
   * optimisation, never a correctness requirement.
   */
  prefetch(page: number): void {
    if (page < 0 || page >= this.totalPages) return;
    const target = this.clampPage(page);
    if (this.cache.has(target) || this.pending.has(target)) return;
    const start = this.startOf(target);
    const end = Math.min(this.rowCount, start + this.pageSize);
    void this.loadRaw(target, start, end).catch(() => undefined);
  }

  /** Read an arbitrary range — what whole-file search scans. */
  async readRange(start: number, end: number): Promise<ParquetRow[]> {
    const from = Math.max(0, Math.min(start, this.rowCount));
    const to = Math.max(from, Math.min(end, this.rowCount));
    if (to <= from) return [];
    return this.source.readRows(from, to);
  }

  /** Drop every cached page and pending load. In-flight work becomes stale. */
  reset(): void {
    this.generation++;
    this.loadSeq++;
    this.cache.clear();
    this.pending.clear();
    this.currentPage = 0;
    this.currentRows = [];
  }

  private async loadRaw(page: number, start: number, end: number): Promise<ParquetRow[]> {
    const cached = this.cache.get(page);
    if (cached) return cached;
    const inFlight = this.pending.get(page);
    if (inFlight) return inFlight;

    const generation = this.generation;
    const load = this.source
      .readRows(start, end)
      .then((rows) => {
        // A reset() while this was in flight must not repopulate the new cache.
        if (generation === this.generation) this.remember(page, rows);
        return rows;
      })
      .finally(() => {
        if (this.pending.get(page) === load) this.pending.delete(page);
      });

    this.pending.set(page, load);
    return load;
  }

  private remember(page: number, rows: ParquetRow[]): void {
    if (rows.length === 0) return;
    this.cache.set(page, rows);
    while (this.cache.size > this.maxCachedPages) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }
}
