/**
 * The JSON Preview's source rule and message loop, without `vscode`.
 *
 * Same split as `jsonlHandlers` and `parquetHandlers`: the decisions that can be wrong (which
 * bytes the preview shows, whether a 500 MB file is read at all, which requests are malformed,
 * what a reload replaces) live here, and `jsonPreview.ts` keeps the panel and the wiring.
 */
import {
  JSON_MAX_ARRAY_BYTES,
  type JsonRecordRequest,
  type JsonRecordsRequest,
  type JsonSearchRequest,
} from "@/common/jsonPreviewTypes";
import { JsonPreviewSession } from "@/service/jsonPreview";

export interface JsonSource {
  text: string;
  byteSize: number;
  /** True only when the text is an unsaved editor buffer, i.e. it differs from the disk. */
  fromBuffer: boolean;
}

/** The three ways the provider can reach a document; the provider backs them with `vscode`. */
export interface JsonSourceReader {
  /** The editor that has this document open, if any. `isDirty` means it has unsaved edits. */
  openBuffer(): { text: string; isDirty: boolean } | undefined;
  stat(): PromiseLike<{ size: number }>;
  readFile(): PromiseLike<Uint8Array>;
}

function utf8Size(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * Read the open buffer when the file is open, otherwise the bytes on disk. The buffer wins
 * because the preview is explicitly opened from an editor and should show what that editor
 * shows; `fromBuffer` tells the UI only when those bytes are actually unsaved.
 */
export async function readJsonSource(reader: JsonSourceReader): Promise<JsonSource> {
  const open = reader.openBuffer();
  if (open) {
    return { text: open.text, byteSize: utf8Size(open.text), fromBuffer: open.isDirty };
  }

  const stat = await reader.stat();
  // A file above this cap can only be too-large; do not read 500 MB to say so.
  if (stat.size > JSON_MAX_ARRAY_BYTES) {
    return { text: "", byteSize: stat.size, fromBuffer: false };
  }
  const bytes = await reader.readFile();
  return {
    text: new TextDecoder().decode(bytes),
    byteSize: bytes.byteLength,
    fromBuffer: false,
  };
}

export interface JsonPreviewHandlerContext {
  fileName: string;
  /** Stable across reloads: the webview keeps its query only when this stays the same. */
  cacheId: string;
  /** Read the document as it is now (`readJsonSource` over the provider's reader). */
  read: () => Promise<JsonSource>;
  emit: (type: string, payload: unknown) => void;
  /** A reload that could not read the document; the old session stays. */
  reportError: (message: string) => void;
}

export function createJsonPreviewHandlers(context: JsonPreviewHandlerContext, initial: JsonSource) {
  const open = (source: JsonSource) =>
    new JsonPreviewSession(
      source.text,
      source.byteSize,
      context.fileName,
      context.cacheId,
      source.fromBuffer,
    );
  // The one owner of the session: a reload replaces it, so every handler reads it at call time.
  let session = open(initial);

  const emitInfo = () => {
    context.emit("jsonInfo", session.info);
    const root = session.rootEntry;
    if (root) context.emit("jsonRoot", { entry: root });
  };

  return {
    /** Always the current session. */
    get session() {
      return session;
    },

    init: emitInfo,

    records(request?: Partial<JsonRecordsRequest>) {
      if (
        typeof request?.requestId !== "number" ||
        typeof request.start !== "number" ||
        typeof request.end !== "number"
      ) {
        return;
      }
      context.emit("jsonRecordsData", {
        requestId: request.requestId,
        records: session.recordsInWindow(request.start, request.end),
      });
    },

    record(request?: Partial<JsonRecordRequest>) {
      if (typeof request?.requestId !== "number" || typeof request.index !== "number") return;
      context.emit("jsonRecordData", {
        requestId: request.requestId,
        index: request.index,
        entry: session.record(request.index),
      });
    },

    search(request?: Partial<JsonSearchRequest>) {
      if (typeof request?.requestId !== "number" || typeof request.query !== "string") return;
      session.search(request.requestId, request.query, {
        onBatch: (batch) => context.emit("jsonSearchBatch", batch),
      });
    },

    cancelSearch() {
      session.cancelSearch();
    },

    /**
     * The file changed on disk, or the user asked for a reload. The new text is read first, so
     * a failed read leaves the old session (and whatever the webview shows) intact; only then is
     * the old session disposed, which also stops its running search.
     */
    async reload() {
      try {
        const source = await context.read();
        session.dispose();
        session = open(source);
        emitInfo();
      } catch (error) {
        context.reportError(error instanceof Error ? error.message : String(error));
      }
    },

    dispose() {
      session.dispose();
    },
  };
}
