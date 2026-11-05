/**
 * Host-side JSONL session: owns the bytes and the line index, and answers the three
 * questions the webview can ask — a window of directory summaries, one full entry, and a
 * whole-file search.
 *
 * Why it is a class and not three functions on the provider: every answer carries the
 * `requestId` of the request that caused it, and a search can be cancelled. Correlation and
 * cancellation are the whole point (the previous provider kept a `latestSearchId` counter
 * that only fell out of sync with the webview's own counter), so they live with the state
 * they belong to and can be exercised without a webview, a Handler or `vscode`.
 */
import {
    JSONL_SEARCH_BATCH,
    JSONL_SEARCH_MAX_MATCHES,
    type JsonlEntriesPayload,
    type JsonlEntryDetail,
    type JsonlEntryPayload,
    type JsonlEntrySummary,
    type JsonlSearchBatch,
} from '@/common/jsonlTypes';
import {
    buildJsonlEntry,
    buildJsonlSummaries,
    matchSnippet,
    readJsonlLineText,
    summarizeDecodedLine,
    type JsonlIndex,
} from '@/service/jsonlDocument';

/** Lines decoded per event-loop turn; keeps a scan responsive on a huge file. */
export const SEARCH_STEP = 20_000;

export interface JsonlSearchOptions {
    /** Matches per message. */
    batchSize?: number
    /** Lines decoded per turn. */
    step?: number
    /** Hard stop, so a broad query cannot exhaust memory. */
    maxMatches?: number
    /** Called for every batch, including the final `done` one. */
    onBatch: (batch: JsonlSearchBatch) => void
    /** Injected so tests can drive the scan without real timers. */
    schedule?: (run: () => void) => void
}

export interface JsonlSearchHandle {
    cancel(): void
    readonly done: boolean
}

export class JsonlSession {
    private bytes: Uint8Array
    private index: JsonlIndex
    private active: symbol | null = null

    constructor(bytes: Uint8Array, index: JsonlIndex) {
        this.bytes = bytes
        this.index = index
    }

    get lineCount(): number {
        return this.index.lineCount
    }

    get byteSize(): number {
        return this.bytes.byteLength
    }

    /** Replace the file's content after an external change. Cancels any running scan. */
    reload(bytes: Uint8Array, index: JsonlIndex): void {
        this.cancelSearch()
        this.bytes = bytes
        this.index = index
    }

    readRange(requestId: number, start: number, end: number): JsonlEntriesPayload {
        const from = Math.max(0, Math.min(start, this.index.lineCount))
        const to = Math.max(from, Math.min(end, this.index.lineCount))
        return {
            requestId,
            start: from,
            entries: buildJsonlSummaries(this.bytes, this.index, from, to),
        }
    }

    readEntry(requestId: number, line: number): JsonlEntryPayload | null {
        if (!Number.isInteger(line) || line < 0 || line >= this.index.lineCount) return null
        const entry: JsonlEntryDetail = buildJsonlEntry(this.bytes, this.index, line)
        return { requestId, index: line, entry }
    }

    /**
     * Scan every line for `query` (case-insensitive substring of the raw text), emitting
     * batches as matches are found. A newer search cancels the previous one: the old scan
     * stops on its next turn instead of finishing and having its output dropped.
     */
    search(requestId: number, query: string, options: JsonlSearchOptions): JsonlSearchHandle {
        const batchSize = options.batchSize ?? JSONL_SEARCH_BATCH
        const step = options.step ?? SEARCH_STEP
        const maxMatches = options.maxMatches ?? JSONL_SEARCH_MAX_MATCHES
        const schedule = options.schedule ?? (run => setTimeout(run, 0))
        const total = this.index.lineCount
        const needle = (query ?? '').trim().toLowerCase()
        const token = Symbol('search')

        this.active = token
        const cancelled = () => this.active !== token

        if (!needle) {
            options.onBatch({
                requestId, query, entries: [], scanned: 0, total, matches: 0, done: true, capped: false,
            })
            this.active = null
            return { cancel: () => undefined, done: true }
        }

        let scanned = 0
        let matches = 0
        let capped = false
        let pending: JsonlEntrySummary[] = []

        const flush = (done: boolean) => {
            options.onBatch({
                requestId, query, entries: pending, scanned, total, matches, done, capped,
            })
            pending = []
        }

        const finish = () => {
            if (this.active === token) this.active = null
        }

        const stepOnce = () => {
            if (cancelled()) return
            const until = Math.min(total, scanned + step)
            for (let line = scanned; line < until; line++) {
                const decoded = readJsonlLineText(this.bytes, this.index, line)
                if (!decoded.text.toLowerCase().includes(needle)) continue
                matches++
                pending.push({
                    ...summarizeDecodedLine(line, decoded),
                    snippet: matchSnippet(decoded.text, needle),
                })
                if (pending.length >= batchSize) flush(false)
                if (matches >= maxMatches) {
                    capped = true
                    break
                }
            }
            scanned = until

            if (capped || scanned >= total) {
                flush(true)
                finish()
                return
            }
            flush(false)
            schedule(stepOnce)
        }

        schedule(stepOnce)

        return {
            cancel: () => {
                if (this.active === token) this.active = null
            },
            get done() {
                return this.active !== token
            },
        }
    }

    cancelSearch(): void {
        this.active = null
    }
}
