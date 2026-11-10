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
 *  3. Reads are cached in **chunks**, not pages, and the cache is bounded. Decoding a parquet
 *     data page costs the same whether one row is asked for or twenty thousand — measured on a
 *     202 MB / 1.1 M row file: 50 rows and 20,000 rows both read 22.6 MB and took ~1.4 s. With a
 *     page-sized read every turn paid that cost; with a chunk it is paid once per chunk and the
 *     turns inside it cost nothing.
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
  /** Rows read in one go. Deliberately much larger than a page; see invariant 3. */
  chunkSize?: number;
  /** Chunks kept in memory; the viewer prefetches the next one. */
  maxCachedChunks?: number;
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
const DEFAULT_CHUNK_SIZE = 5_000;
const DEFAULT_MAX_CACHED_CHUNKS = 3;

export class ParquetSession {
  readonly chunkSize: number;
  readonly rowCount: number;

  private readonly source: ParquetRowsSource;
  private readonly maxCachedChunks: number;
  private readonly cache = new Map<number, ParquetRow[]>();
  private readonly pending = new Map<number, Promise<ParquetRow[]>>();

  private pageSizeValue: number;

  /** Bumped by reset(); in-flight work from an older generation is discarded. */
  private generation = 0;
  /** Bumped by showPage(); only the newest load may become `rows`. */
  private loadSeq = 0;

  private currentPage = 0;
  private currentRows: ParquetRow[] = [];

  constructor(source: ParquetRowsSource, options: ParquetSessionOptions = {}) {
    this.source = source;
    this.pageSizeValue = Math.max(1, options.pageSize ?? DEFAULT_PAGE_SIZE);
    this.chunkSize = Math.max(this.pageSizeValue, options.chunkSize ?? DEFAULT_CHUNK_SIZE);
    this.rowCount = Math.max(0, source.rowCount);
    this.maxCachedChunks = Math.max(1, options.maxCachedChunks ?? DEFAULT_MAX_CACHED_CHUNKS);
  }

  /** Rows per page. The viewer keeps this equal to the rows its viewport shows. */
  get pageSize(): number {
    return this.pageSizeValue;
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.rowCount / this.pageSizeValue));
  }

  /**
   * Change the page size without losing the decoded chunks.
   *
   * A page is "one screenful", so it changes with the window. The cache is keyed by chunk, which
   * does not depend on the page size, so re-paging a big file must not cost another read.
   * Returns the clamped page holding `keepRow`, so the caller can stay on the same row.
   */
  setPageSize(size: number, keepRow = 0): number {
    const next = Math.max(1, Math.min(this.chunkSize, Math.floor(size)));
    this.pageSizeValue = next;
    return this.clampPage(Math.floor(Math.max(0, keepRow) / next));
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
    // A load sliced with one page size must not land after another page size took over: the
    // rows would be right but the page-local cursor row would point at a different row.
    const pageSize = this.pageSizeValue;

    const rows = await this.loadRows(start, end);
    if (generation !== this.generation || seq !== this.loadSeq || pageSize !== this.pageSizeValue) {
      return { page: target, start, end, rows: [], stale: true };
    }

    this.currentPage = target;
    this.currentRows = rows;
    return { page: target, start, end, rows, stale: false };
  }

  /**
   * Warm the cache for `page` without waiting. Failures are swallowed: a prefetch is an
   * optimisation, never a correctness requirement.
   *
   * Reads the page's chunk, and — once that chunk is in memory — the one after it. Crossing a
   * chunk boundary costs a full read, so leaving it to the turn that hits it would make one page
   * turn in every hundred slow for no reason.
   */
  prefetch(page: number): void {
    if (page < 0 || page >= this.totalPages) return;
    const chunk = this.chunkOf(this.startOf(this.clampPage(page)));
    if (!this.cache.has(chunk)) {
      this.warmChunk(chunk);
      return;
    }
    this.warmChunk(chunk + 1);
  }

  /** Drop every cached chunk and pending load. In-flight work becomes stale. */
  reset(): void {
    this.generation++;
    this.loadSeq++;
    this.cache.clear();
    this.pending.clear();
    this.currentPage = 0;
    this.currentRows = [];
  }

  private chunkOf(row: number): number {
    return Math.floor(row / this.chunkSize);
  }

  /** Rows `[start, end)` from whichever chunk holds them. */
  private async loadRows(start: number, end: number): Promise<ParquetRow[]> {
    const chunk = this.chunkOf(start);
    const chunkStart = chunk * this.chunkSize;
    const rows = await this.loadChunk(chunk);
    return rows.slice(start - chunkStart, end - chunkStart);
  }

  private loadChunk(chunk: number): Promise<ParquetRow[]> {
    if (chunk * this.chunkSize >= this.rowCount) return Promise.resolve([]);
    const cached = this.cache.get(chunk);
    if (cached) return Promise.resolve(cached);
    const inFlight = this.pending.get(chunk);
    if (inFlight) return inFlight;

    const start = chunk * this.chunkSize;
    const end = Math.min(this.rowCount, start + this.chunkSize);
    const generation = this.generation;
    const load = this.source
      .readRows(start, end)
      .then((rows) => {
        // A reset() while this was in flight must not repopulate the new cache.
        if (generation === this.generation) this.remember(chunk, rows);
        return rows;
      })
      .finally(() => {
        if (this.pending.get(chunk) === load) this.pending.delete(chunk);
      });

    this.pending.set(chunk, load);
    return load;
  }

  private warmChunk(chunk: number): void {
    if (chunk * this.chunkSize >= this.rowCount) return;
    if (this.cache.has(chunk) || this.pending.has(chunk)) return;
    void this.loadChunk(chunk).catch(() => undefined);
  }

  private remember(chunk: number, rows: ParquetRow[]): void {
    if (rows.length === 0) return;
    this.cache.set(chunk, rows);
    while (this.cache.size > this.maxCachedChunks) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }
}
