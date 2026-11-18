/**
 * JSONL adapter: provides search functionality for JSONL files.
 *
 * Records are line-delimited; the file's existing line index provides the boundaries.
 */
import type { JsonlEntrySummary, JsonlSearchBatch } from "@/common/jsonlTypes";
import {
  JSONL_SEARCH_BATCH,
  JSONL_SEARCH_BYTE_BUDGET,
  JSONL_SEARCH_MAX_MATCHES,
} from "@/common/jsonlTypes";
import { byteNeedle, candidateLines } from "@/service/jsonlByteSearch";
import {
  decodeJsonlLine,
  matchSnippet as jsonlMatchSnippet,
  readJsonlLineText,
  summarizeDecodedLine,
} from "@/service/jsonlDocument";
import type { JsonlFile } from "@/service/jsonlFile";
import {
  foldNeedle,
  type CancelToken,
  type SearchOptions,
} from "@/service/recordAddressableDocument";

/** Lines decoded per event-loop turn; keeps a scan responsive on a huge file. */
const SEARCH_STEP = 20_000;

/**
 * Adapter that provides search for JSONL files.
 * Each line is a record.
 */
export class JsonlAdapter {
  constructor(private readonly file: JsonlFile) {}

  get recordCount(): number {
    return this.file.lineCount;
  }

  search(
    requestId: number,
    query: string,
    options: SearchOptions<JsonlSearchBatch>,
    cancelToken: CancelToken,
  ): void {
    const needle = foldNeedle(query);

    if (!needle) {
      const emptyBatch: JsonlSearchBatch = {
        requestId,
        query,
        entries: [],
        scanned: 0,
        total: this.file.lineCount,
        matches: 0,
        done: true,
        capped: false,
      };
      options.onBatch(emptyBatch);
      return;
    }

    const byteSearch = byteNeedle(needle);
    const batchSize = options.batchSize ?? JSONL_SEARCH_BATCH;
    const maxMatches = options.maxMatches ?? JSONL_SEARCH_MAX_MATCHES;
    const schedule = options.schedule ?? ((run) => setTimeout(run, 0));
    const step = options.step ?? SEARCH_STEP;

    let scanned = 0;
    let matches = 0;
    let capped = false;
    let pending: JsonlEntrySummary[] = [];

    const flush = (done: boolean) => {
      const batch: JsonlSearchBatch = {
        requestId,
        query,
        entries: pending,
        scanned, // This is a line count, not bytes
        total: this.file.lineCount, // Total lines, not bytes
        matches,
        done,
        capped,
      };
      options.onBatch(batch);
      pending = [];
    };

    const stepOnce = async () => {
      if (cancelToken.cancelled) {
        // Don't send any more batches after cancellation
        return;
      }

      // Lines alone do not bound the read: 20,000 lines of a 500 KB transcript is 10 GB.
      // `advance` stops on whichever limit comes first, and always moves at least one line.
      const until = Math.max(
        scanned + 1,
        Math.min(this.file.lineCount, this.file.advance(scanned, step, JSONL_SEARCH_BYTE_BUDGET)),
      );

      let raw;
      try {
        raw = await this.file.readLines(scanned, until);
      } catch {
        // A read failure ends the scan politely; the webview keeps what it has.
        if (!cancelToken.cancelled) flush(true);
        return;
      }

      if (cancelToken.cancelled) {
        // Check again after async operation
        return;
      }

      // Byte path: the raw window is scanned once and only candidate lines are decoded. It needs
      // an ASCII needle and bytes that match the line index; otherwise every line is decoded.
      const candidates =
        byteSearch && raw.complete
          ? candidateLines(
              raw.bytes,
              this.file.index.offsets,
              raw.first,
              raw.last,
              raw.start,
              byteSearch,
            )
          : undefined;
      const window = candidates ? undefined : this.file.toWindow(raw);
      const count = candidates ? candidates.length : window!.index.lineCount;

      for (let n = 0; n < count; n++) {
        const offset = candidates ? candidates[n] - scanned : n;
        const rawText = candidates
          ? decodeJsonlLine(this.file.lineSlice(raw, candidates[n]))
          : readJsonlLineText(window!.bytes, window!.index, offset);
        // Case-insensitive match; needle is already lowercased by caller
        // One pass decides the hit and yields the snippet; no lowercase copy of the line.
        // On the byte path this is still the decision: the prefilter only over-approximates.
        const snippet = jsonlMatchSnippet(rawText, needle);
        if (snippet === undefined) continue;

        matches++;
        const summary = summarizeDecodedLine(scanned + offset, rawText, needle);
        pending.push({ ...summary, snippet });

        if (pending.length >= batchSize) {
          if (cancelToken.cancelled) return;
          flush(false);
        }
        if (matches >= maxMatches) {
          capped = true;
          break;
        }
      }

      scanned = until;

      if (cancelToken.cancelled) {
        // Exit without sending final batch
        return;
      }

      if (capped || scanned >= this.file.lineCount) {
        flush(true);
        return;
      }

      if (pending.length > 0) flush(false);
      schedule(() => {
        void stepOnce();
      });
    };

    schedule(() => {
      void stepOnce();
    });
  }

  dispose(): void {
    this.file.close();
  }
}

/**
 * Create a JSONL adapter from a JsonlFile.
 */
export function jsonlAdapter(file: JsonlFile): JsonlAdapter {
  return new JsonlAdapter(file);
}
