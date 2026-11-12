/**
 * The parquet viewer's message loop, without `vscode`.
 *
 * Same split as `jsonlHandlers`: the decisions that can be wrong (a malformed request, a file
 * that moved or is not parquet, a reply the caller is waiting for) live here, and the provider
 * keeps only the wiring. The profile is the first message the host answers for parquet —
 * paging and search still run in the webview (ADR-0020).
 */
import type { ParquetProfilePayload, ParquetProfileRequest } from "../common/parquetProfileTypes";
import type { ByteSource } from "../service/jsonlFile";
import { readParquetProfile } from "../service/parquetProfile";

export interface ParquetHandlerContext {
  /** Open the document's bytes: the provider owns the scheme decision (`openByteSource`). */
  openSource: () => Promise<ByteSource>;
  emit: (type: string, payload: unknown) => void;
}

export function createParquetHandlers(context: ParquetHandlerContext) {
  return {
    async profile(request?: Partial<ParquetProfileRequest>) {
      if (typeof request?.requestId !== "number") return;
      const { requestId } = request;
      let payload: ParquetProfilePayload;
      try {
        const source = await context.openSource();
        try {
          payload = { requestId, profile: await readParquetProfile(source) };
        } finally {
          await source.close?.();
        }
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
  };
}
