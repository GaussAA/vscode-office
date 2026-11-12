/**
 * The parquet viewer's message loop, without `vscode`.
 *
 * Same split as `jsonlHandlers`: the decisions that can be wrong (a malformed request, a file
 * that moved or is not parquet, a reply the caller is waiting for) live here, and the provider
 * keeps only the wiring. The profile is the first message the host answers for parquet —
 * paging and search still run in the webview (ADR-0020).
 */
import type {
  ParquetColumnScanPayload,
  ParquetColumnScanRequest,
  ParquetProfilePayload,
  ParquetProfileRequest,
} from "../common/parquetProfileTypes";
import type { ByteSource } from "../service/jsonlFile";
import { readParquetProfile, scanParquetColumn } from "../service/parquetProfile";

export interface ParquetHandlerContext {
  /** Open the document's bytes: the provider owns the scheme decision (`openByteSource`). */
  openSource: () => Promise<ByteSource>;
  emit: (type: string, payload: unknown) => void;
}

/** Run `work` against a freshly opened source and always close it. */
async function withSource<T>(
  context: ParquetHandlerContext,
  work: (source: ByteSource) => Promise<T>,
): Promise<T> {
  const source = await context.openSource();
  try {
    return await work(source);
  } finally {
    await source.close?.();
  }
}

export function createParquetHandlers(context: ParquetHandlerContext) {
  return {
    async profile(request?: Partial<ParquetProfileRequest>) {
      if (typeof request?.requestId !== "number") return;
      const { requestId } = request;
      let payload: ParquetProfilePayload;
      try {
        payload = { requestId, profile: await withSource(context, readParquetProfile) };
      } catch (error) {
        // A failed profile still has to answer, otherwise the caller waits for a reply that
        // never comes; the error travels with the empty result instead of replacing it.
        payload = {
          requestId,
          profile: null,
          error: error instanceof Error ? error.message : String(error),
        };
      }
      context.emit("parquetProfileData", payload);
    },

    /**
     * Cardinality and top-N for one column. Opt-in and bounded: the scan decodes a prefix and
     * the reply says how much it covered, so the panel can label a partial answer.
     */
    async columnScan(request?: Partial<ParquetColumnScanRequest>) {
      if (typeof request?.requestId !== "number" || typeof request.name !== "string") return;
      const { requestId, name } = request;
      let payload: ParquetColumnScanPayload;
      try {
        payload = {
          requestId,
          scan: await withSource(context, (source) => scanParquetColumn(source, name)),
        };
      } catch (error) {
        payload = {
          requestId,
          scan: null,
          error: error instanceof Error ? error.message : String(error),
        };
      }
      context.emit("parquetColumnScanData", payload);
    },
  };
}
