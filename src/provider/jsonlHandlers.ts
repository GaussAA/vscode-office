/**
 * The JSONL viewer's message loop, without `vscode`.
 *
 * The provider used to inline this: every `handler.on(...)` body opened the session, built a
 * payload and emitted, so the only way to exercise the glue was to run a real VS Code window.
 * The decisions that can actually be wrong (guard a malformed request, survive a file that
 * moved underneath us, supersede a running search, reload after a change on disk) are here,
 * and `JsonlViewerProvider` is left with nothing but wiring.
 */
import {
    JSONL_CHUNK_SIZE,
    type JsonlEntriesPayload,
    type JsonlEntryPayload,
    type JsonlEntryRequest,
    type JsonlInfoPayload,
    type JsonlRangeRequest,
    type JsonlSearchBatch,
    type JsonlSearchCancel,
    type JsonlSearchRequest,
} from '../common/jsonlTypes';
import type { JsonlSession } from '../service/jsonlSession';

export interface JsonlHandlerContext {
    /** Always the current session: a reload replaces it, so this must be a getter. */
    session: () => JsonlSession;
    /** Re-read the document from its source and install a fresh session. */
    reopen: () => Promise<void>;
    emit: (type: string, payload: unknown) => void;
    info: () => JsonlInfoPayload;
}

export function createJsonlHandlers(context: JsonlHandlerContext) {
    const { session, reopen, emit, info } = context;

    return {
        init() {
            emit('jsonlInfo', info());
        },

        /** The file changed on disk, or the user asked for a reload. */
        async reload() {
            await reopen();
            emit('jsonlInfo', info());
        },

        async index(request?: JsonlRangeRequest) {
            if (typeof request?.requestId !== 'number') return;
            const start = Math.max(0, request.start ?? 0);
            const end = request.end ?? start + JSONL_CHUNK_SIZE;
            let payload: JsonlEntriesPayload;
            try {
                payload = await session().readRange(request.requestId, start, end);
            } catch {
                return; // the file was swapped underneath us; the webview will ask again
            }
            emit('jsonlEntries', payload);
        },

        async entry(request?: JsonlEntryRequest) {
            if (typeof request?.requestId !== 'number') return;
            let payload: JsonlEntryPayload | null = null;
            try {
                payload = await session().readEntry(request.requestId, request.index);
            } catch {
                return;
            }
            if (payload) emit('jsonlEntryData', payload);
        },

        search(request?: JsonlSearchRequest) {
            if (typeof request?.requestId !== 'number') return;
            // A newer search supersedes the running one; the session stops it on its next turn.
            session().cancelSearch();
            session().search(request.requestId, request.query, {
                onBatch: (batch: JsonlSearchBatch) => {
                    emit('jsonlSearchBatch', batch);
                },
            });
        },

        cancelSearch(_request?: JsonlSearchCancel) {
            session().cancelSearch();
        },
    };
}
