/**
 * Host-side JSONL session: owns the file view and answers the three questions the webview
 * can ask — a window of directory summaries, one full entry, and a whole-file search.
 *
 * Reads go through `JsonlFile`, which keeps only the line index and fetches one byte window
 * per request, so a 500 MB file costs a few megabytes of host memory instead of its own size.
 *
 * Every answer carries the `requestId` of the request that caused it, and a scan can be
 * cancelled — correlation and cancellation belong with the state they describe, not with the
 * provider that happens to receive the message.
 */
import {
    JSONL_SEARCH_BATCH,
    JSONL_SEARCH_MAX_MATCHES,
    type JsonlEntriesPayload,
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
} from '@/service/jsonlDocument';
import type { JsonlFile } from '@/service/jsonlFile';

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
    /** Resolves when the scan finished or was cancelled — handy for tests and callers. */
    readonly finished: Promise<void>
}

export class JsonlSession {
    private active: symbol | null = null

    constructor(readonly file: JsonlFile) { }

    get lineCount(): number {
        return this.file.lineCount
    }

    get byteSize(): number {
        return this.file.byteSize
    }

    cancelSearch(): void {
        this.active = null
    }

    dispose(): void {
        this.cancelSearch()
        this.file.close()
    }

    async readRange(requestId: number, start: number, end: number): Promise<JsonlEntriesPayload> {
        const from = Math.max(0, Math.min(start, this.file.lineCount))
        const to = Math.max(from, Math.min(end, this.file.lineCount))
        if (to <= from) return { requestId, start: from, entries: [] }
        const window = await this.file.window(from, to)
        return {
            requestId,
            start: from,
            // baseLine keeps the absolute line numbers even though the index is local to the window.
            entries: buildJsonlSummaries(window.bytes, window.index, 0, window.index.lineCount, from),
        }
    }

    async readEntry(requestId: number, line: number): Promise<JsonlEntryPayload | null> {
        if (!Number.isInteger(line) || line < 0 || line >= this.file.lineCount) return null
        const window = await this.file.window(line, line + 1)
        if (window.index.lineCount === 0) return null
        return { requestId, index: line, entry: buildJsonlEntry(window.bytes, window.index, 0, line) }
    }

    /**
     * Scan every line for `query` (case-insensitive substring of the raw text), emitting
     * batches as matches are found. A newer search cancels this one: the scan stops on its
     * next turn instead of reading the rest of the file for output nobody will use.
     */
    search(requestId: number, query: string, options: JsonlSearchOptions): JsonlSearchHandle {
        const batchSize = options.batchSize ?? JSONL_SEARCH_BATCH
        const step = options.step ?? SEARCH_STEP
        const maxMatches = options.maxMatches ?? JSONL_SEARCH_MAX_MATCHES
        const schedule = options.schedule ?? (run => setTimeout(run, 0))
        const total = this.file.lineCount
        const needle = (query ?? '').trim().toLowerCase()
        const token = Symbol('search')

        this.active = token
        const cancelled = () => this.active !== token

        let settle: () => void = () => undefined
        const finished = new Promise<void>(resolve => { settle = resolve })

        if (!needle) {
            options.onBatch({
                requestId, query, entries: [], scanned: 0, total, matches: 0, done: true, capped: false,
            })
            this.active = null
            settle()
            return { cancel: () => undefined, done: true, finished }
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

        const stepOnce = async () => {
            if (cancelled()) return
            const until = Math.min(total, scanned + step)
            let window
            try {
                window = await this.file.window(scanned, until)
            } catch {
                // A read failure ends the scan politely; the webview keeps what it has.
                if (!cancelled()) flush(true)
                if (this.active === token) this.active = null
                settle()
                return
            }
            if (cancelled()) {
                settle()
                return
            }

            for (let offset = 0; offset < window.index.lineCount; offset++) {
                const decoded = readJsonlLineText(window.bytes, window.index, offset)
                if (!decoded.text.toLowerCase().includes(needle)) continue
                matches++
                pending.push({
                    ...summarizeDecodedLine(scanned + offset, decoded),
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
                if (this.active === token) this.active = null
                settle()
                return
            }
            flush(false)
            schedule(() => { void stepOnce() })
        }

        schedule(() => { void stepOnce() })

        // `this` inside the returned object's getter is the object itself, not the session —
        // the getter used to read `this.active` and therefore always saw undefined. The arrow
        // below keeps the session's `this` while still being safe to read from the getter.
        const isDone = () => this.active !== token
        return {
            cancel: () => {
                if (this.active === token) this.active = null
                settle()
            },
            get done() {
                return isDone()
            },
            finished,
        }
    }
}
