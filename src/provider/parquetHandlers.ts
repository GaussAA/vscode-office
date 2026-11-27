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
  ParquetEmptyShare,
  ParquetEmptyShareScanPayload,
  ParquetEmptyShareScanRequest,
  ParquetProfilePayload,
  ParquetProfileRequest,
} from "../common/parquetProfileTypes";
import type {
  ParquetSearchCancel,
  ParquetSearchData,
  ParquetSearchProgress,
  ParquetSearchRequest,
} from "../common/parquetSearchTypes";
import { PARQUET_SEARCH_MAX_ROWS } from "../common/parquetSearchTypes";
import { emptyShareOf } from "../common/parquetProfileTypes";
import type { ByteSource } from "../common/byteSource";
import { asyncBufferFrom } from "../common/parquetSchema";
import { openParquetFile } from "../common/parquetReader";
import { readParquetProfile, scanEmptyShares, scanParquetColumn } from "../service/parquetProfile";
import { searchParquetValues } from "../service/parquetSearch";
import {
  parquetScanCache,
  type ParquetScanCache,
  type ParquetScanFingerprint,
} from "../service/parquetScanCache";

export interface ParquetHandlerContext {
  /** Open the document's bytes: the provider owns the scheme decision (`openByteSource`). */
  openSource: () => Promise<ByteSource>;
  emit: (type: string, payload: unknown) => void;
  /**
   * The document identity + the stat fingerprint. Absent (or null) means this host cannot
   * validate bytes, so scans run but are not cached; inline documents answer null.
   */
  fingerprint?: () => Promise<ParquetScanFingerprint | null>;
  /** Injectable for tests; the provider and the Clear cache command share the singleton. */
  cache?: ParquetScanCache;
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
  const cache = context.cache ?? parquetScanCache;
  let activeEmptyScan: AbortController | null = null;
  let activeSearch: { requestId: number; cancelled: boolean } | null = null;
  /**
   * The last few finished searches, keyed by normalized query + scanned columns.
   *
   * A whole-file search is one pass over the file, and stepping through hits re-runs it only
   * when the text changes. The webview used to hold this memo (ADR-0025); now that the scan
   * runs here, the answer lives next to the bytes it describes.
   */
  const searchCache = new Map<
    string,
    Pick<ParquetSearchData, "rows" | "columns" | "rowCount" | "capped" | "scanned">
  >();
  const SEARCH_CACHE_QUERIES = 3;
  let disposed = false;
  const emit = (type: string, payload: unknown) => {
    // A reply after the webview is gone has no receiver; the old viewer's scan must not keep
    // the host busy either, which `dispose` below takes care of.
    if (!disposed) context.emit(type, payload);
  };

  /**
   * The cache key for this request, or null when the bytes cannot be validated. A missing
   * mtime is "cannot validate", never a cacheable zero; inline bytes never reach the host.
   */
  const fingerprintOf = async (request: { cacheable?: boolean }) => {
    if (request.cacheable === false || !context.fingerprint) return null;
    try {
      const fingerprint = await context.fingerprint();
      return fingerprint && fingerprint.mtimeMs !== undefined ? fingerprint : null;
    } catch {
      return null;
    }
  };

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
      emit("parquetProfileData", payload);
    },

    /**
     * Cardinality and top-N for one column. Opt-in and bounded: the scan decodes a prefix and
     * the reply says how much it covered, so the panel can label a partial answer.
     */
    async columnScan(request?: Partial<ParquetColumnScanRequest>) {
      if (typeof request?.requestId !== "number" || typeof request.name !== "string") return;
      const { requestId, name } = request;
      const run = () => withSource(context, (source) => scanParquetColumn(source, name));
      let payload: ParquetColumnScanPayload;
      try {
        const fingerprint = await fingerprintOf(request);
        payload = {
          requestId,
          scan: fingerprint ? await cache.scan(fingerprint, name, run) : await run(),
        };
      } catch (error) {
        payload = {
          requestId,
          scan: null,
          error: error instanceof Error ? error.message : String(error),
        };
      }
      emit("parquetColumnScanData", payload);
    },

    /**
     * The rail-level batch scan. One request, one source, one pass over a bounded prefix; the
     * progress message is throttled by the service. Columns already scanned for the panel are
     * answered from the host cache instead of being decoded again. A newer batch aborts the
     * previous one, and `dispose` aborts it when the viewer closes.
     */
    async emptyShareScan(request?: Partial<ParquetEmptyShareScanRequest>) {
      if (typeof request?.requestId !== "number" || !Array.isArray(request.names)) return;
      const { requestId } = request;
      const names = [...new Set(request.names)].filter(
        (name): name is string => typeof name === "string",
      );
      if (names.length === 0) return;
      activeEmptyScan?.abort();
      const controller = new AbortController();
      activeEmptyScan = controller;
      let payload: ParquetEmptyShareScanPayload;
      try {
        const fingerprint = await fingerprintOf(request);
        const shares = new Map<string, ParquetEmptyShare>();
        const misses: string[] = [];
        for (const name of names) {
          const scan = fingerprint ? cache.get(fingerprint, name) : undefined;
          if (scan) shares.set(name, emptyShareOf(scan));
          else misses.push(name);
        }
        if (misses.length > 0) {
          const scanned = await withSource(context, (source) =>
            scanEmptyShares(source, misses, {
              signal: controller.signal,
              onProgress: (scannedRows, total) =>
                emit("parquetEmptyShareScanProgress", { requestId, scanned: scannedRows, total }),
            }),
          );
          for (const share of scanned) shares.set(share.name, share);
        }
        payload = {
          requestId,
          // Preserve the request order; the UI keys by name but deterministic output is cheaper
          // to test and keeps the rail's reveal order stable.
          shares: names
            .map((name) => shares.get(name))
            .filter((share): share is ParquetEmptyShare => share !== undefined),
        };
      } catch (error) {
        payload = {
          requestId,
          shares: null,
          error: error instanceof Error ? error.message : String(error),
        };
      } finally {
        if (activeEmptyScan === controller) activeEmptyScan = null;
      }
      emit("parquetEmptyShareScanData", payload);
    },

    /**
     * A whole-file search, run here because the scan is CPU- and memory-bound (ADR-0031).
     * One search at a time: a newer request cancels the previous scan, and a cancelled scan
     * opens no cached entry.
     */
    async search(request?: Partial<ParquetSearchRequest>) {
      if (typeof request?.requestId !== "number" || typeof request.query !== "string") return;
      const { requestId } = request;
      if (activeSearch) activeSearch.cancelled = true;
      const token = { requestId, cancelled: false };
      activeSearch = token;

      const query = request.query;
      const requested = Array.isArray(request.columns)
        ? [...new Set(request.columns)].filter(
            (index): index is number => Number.isInteger(index) && index >= 0,
          )
        : undefined;
      const key = `${query.trim().toLowerCase()}|${requested ? requested.join(",") : "*"}`;
      const cached = searchCache.get(key);
      if (cached) {
        // LRU: a re-used query moves to the newest slot.
        searchCache.delete(key);
        searchCache.set(key, cached);
        emit("parquetSearchData", { requestId, ...cached, cancelled: false });
        if (activeSearch === token) activeSearch = null;
        return;
      }

      let payload: ParquetSearchData;
      try {
        payload = await withSource(context, async (source) => {
          if (token.cancelled || disposed) {
            return {
              requestId,
              rows: [],
              columns: [],
              rowCount: 0,
              capped: false,
              cancelled: true,
              scanned: 0,
            };
          }
          const info = await openParquetFile(asyncBufferFrom(source), {
            initialFetchSize: 8,
          });
          const result = await searchParquetValues(info, query, {
            maxRows: PARQUET_SEARCH_MAX_ROWS,
            columns: requested,
            isCancelled: () => token.cancelled || disposed,
            onProgress: (scanned, matches) => {
              if (token.cancelled || disposed) return;
              const progress: ParquetSearchProgress = {
                requestId,
                scanned,
                total: info.rowCount,
                matches,
              };
              emit("parquetSearchProgress", progress);
            },
          });
          if (token.cancelled || disposed) {
            return {
              requestId,
              rows: [],
              columns: [],
              rowCount: info.rowCount,
              capped: false,
              cancelled: true,
              scanned: 0,
            };
          }
          return {
            requestId,
            rows: result.rows,
            columns: result.columns,
            rowCount: info.rowCount,
            capped: result.capped,
            cancelled: result.cancelled,
            scanned: result.scanned,
          };
        });
        if (!payload.cancelled && !disposed) {
          searchCache.set(key, {
            rows: payload.rows,
            columns: payload.columns,
            rowCount: payload.rowCount,
            capped: payload.capped,
            scanned: payload.scanned,
          });
          while (searchCache.size > SEARCH_CACHE_QUERIES) {
            const oldest = searchCache.keys().next().value;
            if (oldest === undefined) break;
            searchCache.delete(oldest);
          }
        }
      } catch (error) {
        payload = {
          requestId,
          rows: null,
          columns: [],
          rowCount: 0,
          capped: false,
          cancelled: false,
          scanned: 0,
          error: error instanceof Error ? error.message : String(error),
        };
      } finally {
        if (activeSearch === token) activeSearch = null;
      }
      emit("parquetSearchData", payload);
    },

    /** Stop the scan a webview no longer waits for. A stale id is a no-op. */
    cancelSearch(request?: Partial<ParquetSearchCancel>) {
      if (typeof request?.requestId !== "number") return;
      if (activeSearch?.requestId === request.requestId) activeSearch.cancelled = true;
    },

    /** Clear cache: the answers describe bytes that may have changed on disk. */
    clearSearchCache() {
      if (activeSearch) activeSearch.cancelled = true;
      searchCache.clear();
    },

    /** The webview is gone: stop a batch scan instead of letting it read to the row cap. */
    dispose() {
      disposed = true;
      activeEmptyScan?.abort();
      activeEmptyScan = null;
      if (activeSearch) activeSearch.cancelled = true;
      activeSearch = null;
      searchCache.clear();
    },
  };
}
