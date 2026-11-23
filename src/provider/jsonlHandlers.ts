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
  type JsonlEntryTextRequest,
  type JsonlIndexError,
  type JsonlIndexProgress,
  type JsonlInfoPayload,
  type JsonlRangeRequest,
  type JsonlSearchBatch,
  type JsonlSearchCancel,
  type JsonlSearchRequest,
} from "../common/jsonlTypes";
import type { JsonlSession } from "../service/jsonlSession";

export interface ReopenOptions {
  /** Webview-issued request id for progress/info correlation. */
  requestId?: number;
  /** Called during index build with loaded/total bytes. */
  onProgress?: (loaded: number, total: number) => void;
  /** Checked before each chunk; throw if cancelled. */
  cancel?: { readonly cancelled: boolean };
}

export interface JsonlHandlerContext {
  /** The current session, or null if indexing is still in progress. */
  session: () => JsonlSession | null;
  /** Re-read the document from its source and install a fresh session. */
  reopen: (options?: ReopenOptions) => Promise<void>;
  emit: (type: string, payload: unknown) => void;
  info: () => JsonlInfoPayload;
}

export function createJsonlHandlers(context: JsonlHandlerContext) {
  const { session, reopen, emit, info } = context;

  return {
    async init(request?: { requestId?: number }) {
      const s = session();
      if (s) {
        // Session already loaded: answer immediately.
        emit("jsonlInfo", { ...info(), requestId: request?.requestId });
      } else {
        // Not loaded yet: trigger load with progress reporting.
        try {
          await reopen({
            requestId: request?.requestId,
            onProgress: (loaded, total) => {
              if (request?.requestId != null) {
                emit("jsonlIndexProgress", {
                  requestId: request.requestId,
                  loaded,
                  total,
                } satisfies JsonlIndexProgress);
              }
            },
          });
          // Reopen installs the session; emit info once ready.
          emit("jsonlInfo", { ...info(), requestId: request?.requestId });
        } catch (error) {
          // JsonlIndexCancelled: user closed panel, silently ignore
          if (error instanceof Error && error.name === "JsonlIndexCancelled") {
            return;
          }
          // Other errors: notify webview
          if (request?.requestId != null) {
            emit("jsonlIndexError", {
              requestId: request.requestId,
              message: error instanceof Error ? error.message : String(error),
            } satisfies JsonlIndexError);
          }
        }
      }
    },

    /** The file changed on disk, or the user asked for a reload. */
    async reload(request?: { requestId?: number }) {
      try {
        await reopen({
          requestId: request?.requestId,
          onProgress: (loaded, total) => {
            if (request?.requestId != null) {
              emit("jsonlIndexProgress", {
                requestId: request.requestId,
                loaded,
                total,
              } satisfies JsonlIndexProgress);
            }
          },
        });
        emit("jsonlInfo", { ...info(), requestId: request?.requestId });
      } catch (error) {
        // JsonlIndexCancelled: user closed panel, silently ignore
        if (error instanceof Error && error.name === "JsonlIndexCancelled") {
          return;
        }
        // Other errors: notify webview
        if (request?.requestId != null) {
          emit("jsonlIndexError", {
            requestId: request.requestId,
            message: error instanceof Error ? error.message : String(error),
          } satisfies JsonlIndexError);
        }
      }
    },

    async index(request?: Partial<JsonlRangeRequest>) {
      if (typeof request?.requestId !== "number") return;
      const s = session();
      if (!s) {
        // Not loaded yet: return empty.
        emit("jsonlEntries", { requestId: request.requestId, start: 0, entries: [] });
        return;
      }
      const start = Math.max(0, request.start ?? 0);
      const end = request.end ?? start + JSONL_CHUNK_SIZE;
      let payload: JsonlEntriesPayload;
      try {
        payload = await s.readRange(request.requestId, start, end, request.anchor);
      } catch {
        // A failed range still has to answer: the client clears its loading flag on a reply.
        payload = { requestId: request.requestId, start, entries: [] };
      }
      emit("jsonlEntries", payload);
    },

    async entry(request?: Partial<JsonlEntryRequest>) {
      if (typeof request?.requestId !== "number" || typeof request.index !== "number") return;
      const s = session();
      if (!s) {
        // Not loaded yet: return null entry.
        emit("jsonlEntryData", { requestId: request.requestId, index: request.index, entry: null });
        return;
      }
      let payload: JsonlEntryPayload;
      try {
        payload = (await s.readEntry(
          request.requestId,
          request.index,
          request.withText === true,
        )) ?? {
          requestId: request.requestId,
          index: request.index,
          entry: null,
        };
      } catch {
        // A read failure is a terminal answer too; otherwise the detail pane spins forever.
        payload = { requestId: request.requestId, index: request.index, entry: null };
      }
      emit("jsonlEntryData", payload);
    },

    /** Raw text for a detail that arrived without it (ADR-0030). */
    async entryText(request?: Partial<JsonlEntryTextRequest>) {
      if (typeof request?.requestId !== "number" || typeof request.index !== "number") return;
      const s = session();
      if (!s) {
        emit("jsonlEntryTextData", {
          requestId: request.requestId,
          index: request.index,
          text: "",
          textChars: 0,
          textTruncated: false,
        });
        return;
      }
      let payload = {
        requestId: request.requestId,
        index: request.index,
        text: "",
        textChars: 0,
        textTruncated: false,
      };
      try {
        payload = (await s.readEntryText(request.requestId, request.index)) ?? payload;
      } catch {
        // Same terminal-answer rule as `entry`: the raw tab must stop loading.
      }
      emit("jsonlEntryTextData", payload);
    },

    search(request?: JsonlSearchRequest) {
      if (typeof request?.requestId !== "number") return;
      const s = session();
      if (!s) {
        // Not loaded yet: return empty done batch.
        emit("jsonlSearchBatch", {
          requestId: request.requestId,
          query: request.query ?? "",
          entries: [],
          scanned: 0,
          total: 0,
          matches: 0,
          done: true,
          capped: false,
        });
        return;
      }
      // A newer search supersedes the running one; the session stops it on its next turn.
      s.cancelSearch();
      s.search(request.requestId, request.query, {
        onBatch: (batch: JsonlSearchBatch) => {
          emit("jsonlSearchBatch", batch);
        },
      });
    },

    cancelSearch(_request?: JsonlSearchCancel) {
      session()?.cancelSearch();
    },
  };
}
