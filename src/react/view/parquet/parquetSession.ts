/**
 * Parquet paging session: everything about "which rows are on screen, which bytes have
 * already been read, and which cells the user edited" — with no React, no DOM and no
 * hyparquet import, so it can be exercised by `node --test` with a fake reader.
 *
 * The invariants this module owns (each one used to live in a comment inside the component,
 * where several call sites had to remember it separately):
 *
 *  1. Only the newest `showPage()` may land. A slower earlier load resolves as `stale`.
 *  2. A prefetch that started before `reset()` must never populate the new cache. The old
 *     component checked the sequence guard on the visible page but not on the prefetch, so a
 *     reload could serve the previous file's rows from the new file's cache.
 *  3. The cache is raw bytes-to-rows; edits live in one absolute-row map and are applied on
 *     read, so a page cannot be patched twice.
 *  4. The cache is bounded (LRU-ish: oldest insertion wins), and revisiting a page costs no read.
 *  5. Page <-> row arithmetic lives here. Nothing else may do `page * pageSize` again.
 *  6. `readOnly` is derived once, from the source plus the row limit.
 */

export type ParquetRow = Record<string, unknown>

export interface ParquetRowsSource {
    rowCount: number
    readOnly?: boolean
    readRows(start: number, end: number): Promise<ParquetRow[]>
}

export interface ParquetSessionOptions {
    pageSize?: number
    /** Pages kept in memory; the viewer prefetches one page ahead. */
    maxCachedPages?: number
    /** Above this many rows editing is refused: saving re-reads and rewrites the whole file. */
    editRowLimit?: number
}

export interface PageSnapshot {
    page: number
    /** First row of this page, 0-based. */
    start: number
    /** Exclusive end row. */
    end: number
    rows: ParquetRow[]
    /** True when a newer showPage() superseded this one; the caller must ignore it. */
    stale: boolean
}

const DEFAULT_PAGE_SIZE = 50
const DEFAULT_MAX_CACHED_PAGES = 6
const DEFAULT_EDIT_ROW_LIMIT = 200_000

const cellKey = (row: number, column: string) => `${row}:${column}`

export class ParquetSession {
    readonly pageSize: number
    readonly rowCount: number
    readonly totalPages: number
    /** Editing is refused either because the file is read-only or because it is too big. */
    readonly readOnly: boolean
    /** True when reading is allowed but editing was disabled by the row limit. */
    readonly largeFile: boolean

    private readonly source: ParquetRowsSource
    private readonly maxCachedPages: number
    private readonly cache = new Map<number, ParquetRow[]>()
    private readonly pending = new Map<number, Promise<ParquetRow[]>>()
    private readonly edits = new Map<number, Record<string, unknown>>()
    private readonly editedKeys = new Set<string>()

    /** Bumped by reset(); in-flight work from an older generation is discarded. */
    private generation = 0
    /** Bumped by showPage(); only the newest load may become `rows`. */
    private loadSeq = 0

    private currentPage = 0
    private currentRows: ParquetRow[] = []

    constructor(source: ParquetRowsSource, options: ParquetSessionOptions = {}) {
        this.source = source
        this.pageSize = Math.max(1, options.pageSize ?? DEFAULT_PAGE_SIZE)
        this.rowCount = Math.max(0, source.rowCount)
        this.totalPages = Math.max(1, Math.ceil(this.rowCount / this.pageSize))
        this.largeFile = this.rowCount > (options.editRowLimit ?? DEFAULT_EDIT_ROW_LIMIT)
        this.readOnly = (source.readOnly ?? false) || this.largeFile
        this.maxCachedPages = Math.max(1, options.maxCachedPages ?? DEFAULT_MAX_CACHED_PAGES)
    }

    get page(): number {
        return this.currentPage
    }

    /** Rows of the current page, edits already applied. */
    get rows(): ParquetRow[] {
        return this.currentRows
    }

    /** `${absoluteRow}:${column}` for every patched cell. */
    get editedCells(): ReadonlySet<string> {
        return this.editedKeys
    }

    get editedCount(): number {
        return this.edits.size
    }

    startOf(page: number): number {
        return page * this.pageSize
    }

    pageOf(row: number): number {
        return Math.floor(row / this.pageSize)
    }

    clampPage(page: number): number {
        return Math.max(0, Math.min(this.totalPages - 1, page))
    }

    /** Load a page and make it current. Resolves `stale: true` when superseded. */
    async showPage(page: number): Promise<PageSnapshot> {
        const target = this.clampPage(page)
        const start = this.startOf(target)
        const end = Math.min(this.rowCount, start + this.pageSize)
        const seq = ++this.loadSeq
        const generation = this.generation

        const raw = await this.loadRaw(target, start, end)
        if (generation !== this.generation || seq !== this.loadSeq) {
            return { page: target, start, end, rows: [], stale: true }
        }

        this.currentPage = target
        this.currentRows = this.applyEdits(start, raw)
        return { page: target, start, end, rows: this.currentRows, stale: false }
    }

    /**
     * Warm the cache for `page` without waiting. Failures are swallowed: a prefetch is an
     * optimisation, never a correctness requirement.
     */
    prefetch(page: number): void {
        if (page < 0 || page >= this.totalPages) return
        const target = this.clampPage(page)
        if (this.cache.has(target) || this.pending.has(target)) return
        const start = this.startOf(target)
        const end = Math.min(this.rowCount, start + this.pageSize)
        void this.loadRaw(target, start, end).catch(() => undefined)
    }

    /**
     * Record an edit against an absolute row. Returns false when nothing changed (unknown
     * row, read-only session, or identical value), true when the patch was stored.
     */
    patch(row: number, column: string, value: unknown): boolean {
        if (this.readOnly) return false
        if (!Number.isInteger(row) || row < 0 || row >= this.rowCount) return false

        const previous = this.valueAt(row, column)
        if (previous === value) return false

        const patch = this.edits.get(row) ?? {}
        patch[column] = value
        this.edits.set(row, patch)
        this.editedKeys.add(cellKey(row, column))

        // Keep the visible page in step, so the caller can re-render without a reload.
        if (this.pageOf(row) === this.currentPage) {
            const offset = row - this.startOf(this.currentPage)
            const visible = this.currentRows[offset]
            if (visible) this.currentRows[offset] = { ...visible, [column]: value }
        }
        return true
    }

    /** Read an arbitrary range with edits applied — what whole-file search must scan. */
    async readRange(start: number, end: number): Promise<ParquetRow[]> {
        const from = Math.max(0, Math.min(start, this.rowCount))
        const to = Math.max(from, Math.min(end, this.rowCount))
        if (to <= from) return []
        const rows = await this.source.readRows(from, to)
        return this.applyEdits(from, rows)
    }

    /** Re-read every row with the recorded edits applied — the payload of a save. */
    async rowsForSave(): Promise<ParquetRow[]> {
        if (this.rowCount === 0) return []
        const rows = await this.source.readRows(0, this.rowCount)
        for (const [index, patch] of this.edits) {
            const row = rows[index]
            if (row) Object.assign(row, patch)
        }
        return rows
    }

    /** Drop every cached page, edit and pending load. In-flight work becomes stale. */
    reset(): void {
        this.generation++
        this.loadSeq++
        this.cache.clear()
        this.pending.clear()
        this.edits.clear()
        this.editedKeys.clear()
        this.currentPage = 0
        this.currentRows = []
    }

    private valueAt(row: number, column: string): unknown {
        const cached = this.cache.get(this.pageOf(row))
        const offset = row - this.startOf(this.pageOf(row))
        const source = cached?.[offset] ?? undefined
        const base = source ? source[column] : undefined
        const patch = this.edits.get(row)
        return patch && column in patch ? patch[column] : base
    }

    private async loadRaw(page: number, start: number, end: number): Promise<ParquetRow[]> {
        const cached = this.cache.get(page)
        if (cached) return cached
        const inFlight = this.pending.get(page)
        if (inFlight) return inFlight

        const generation = this.generation
        const load = this.source
            .readRows(start, end)
            .then(rows => {
                // A reset() while this was in flight must not repopulate the new cache.
                if (generation === this.generation) this.remember(page, rows)
                return rows
            })
            .finally(() => {
                if (this.pending.get(page) === load) this.pending.delete(page)
            })

        this.pending.set(page, load)
        return load
    }

    private remember(page: number, rows: ParquetRow[]): void {
        if (rows.length === 0) return
        this.cache.set(page, rows)
        while (this.cache.size > this.maxCachedPages) {
            const oldest = this.cache.keys().next().value
            if (oldest === undefined) break
            this.cache.delete(oldest)
        }
    }

    private applyEdits(start: number, rows: ParquetRow[]): ParquetRow[] {
        if (this.edits.size === 0) return rows
        let copied = false
        for (let offset = 0; offset < rows.length; offset++) {
            const patch = this.edits.get(start + offset)
            if (!patch) continue
            if (!copied) {
                rows = rows.slice()
                copied = true
            }
            rows[offset] = { ...rows[offset], ...patch }
        }
        return rows
    }
}
