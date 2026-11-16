/**
 * JSON array adapter: provides search functionality for JSON array documents.
 *
 * Records are array elements; search uses case-insensitive matching without creating lowercase copies.
 */
import {
  JSON_SEARCH_BATCH,
  JSON_SEARCH_MAX_MATCHES,
  type JsonSearchBatch,
} from "@/common/jsonPreviewTypes";
import type { JsonRecordRange } from "@/service/jsonPreview";
import type { CancelToken, SearchOptions } from "@/service/recordAddressableDocument";
import { caseInsensitiveIndexOf, matchSnippet } from "@/service/recordAddressableDocument";

interface JsonSearchRecord {
  index: number;
  size: number;
  raw: string;
  snippet: string;
  count: number;
}

/**
 * Adapter that provides search for JSON array documents.
 * Each array element is a record.
 */
export class JsonArrayAdapter {
  constructor(
    private readonly text: string,
    private readonly records: JsonRecordRange[],
  ) {}

  get recordCount(): number {
    return this.records.length;
  }

  search(
    requestId: number,
    query: string,
    options: SearchOptions<JsonSearchBatch>,
    cancelToken: CancelToken,
  ): void {
    const needle = query.trim().toLowerCase();

    if (!needle) {
      const emptyBatch: JsonSearchBatch = {
        requestId,
        query,
        records: [],
        scanned: 0,
        total: this.text.length,
        matches: 0,
        done: true,
        capped: false,
      };
      options.onBatch(emptyBatch);
      return;
    }

    const batchSize = options.batchSize ?? JSON_SEARCH_BATCH;
    const maxMatches = options.maxMatches ?? JSON_SEARCH_MAX_MATCHES;
    const schedule = options.schedule ?? ((run) => setTimeout(run, 0));

    // Process records in batches
    const BATCH_SIZE = 1000;
    let processedRecords = 0;
    let matches = 0;
    let capped = false;
    let pending: JsonSearchRecord[] = [];

    const flush = (done: boolean) => {
      const batch: JsonSearchBatch = {
        requestId,
        query,
        records: pending.map((r) => ({ index: r.index, count: r.count, snippet: r.snippet })),
        scanned: Math.floor((processedRecords / this.records.length) * this.text.length),
        total: this.text.length,
        matches,
        done,
        capped,
      };
      options.onBatch(batch);
      pending = [];
    };

    const processBatch = () => {
      if (cancelToken.cancelled) return;

      const batchEnd = Math.min(processedRecords + BATCH_SIZE, this.records.length);

      for (
        let index = processedRecords;
        index < batchEnd && !cancelToken.cancelled && !capped;
        index++
      ) {
        const range = this.records[index];
        const raw = this.text.slice(range.start, range.end);
        let cursor = 0;
        let recordMatches = 0;
        let firstSnippet: string | null = null;

        // Find all matches in this record using case-insensitive search
        while (cursor < raw.length) {
          const at = caseInsensitiveIndexOf(raw, needle, cursor);
          if (at < 0) break;

          if (recordMatches === 0) {
            // Capture snippet from first match
            firstSnippet = matchSnippet(raw, needle);
          }

          recordMatches++;
          matches++;
          cursor = at + Math.max(1, needle.length);

          if (matches >= maxMatches) {
            capped = true;
            break;
          }
        }

        if (recordMatches > 0 && firstSnippet) {
          pending.push({
            index,
            size: 0, // unused, for internal tracking only
            raw: "",
            snippet: firstSnippet,
            count: recordMatches,
          });

          if (pending.length >= batchSize) {
            flush(false);
          }
        }
      }

      processedRecords = batchEnd;

      if (cancelToken.cancelled) {
        // Exit without sending any batch after cancellation
        return;
      }

      if (capped || processedRecords >= this.records.length) {
        flush(true);
        return;
      }

      if (pending.length > 0) flush(false);
      schedule(() => processBatch());
    };

    schedule(() => processBatch());
  }

  dispose(): void {
    // No resources to clean up for in-memory adapter
  }
}

/**
 * Create a JSON array adapter from text and record ranges.
 */
export function jsonArrayAdapter(text: string, records: JsonRecordRange[]): JsonArrayAdapter {
  return new JsonArrayAdapter(text, records);
}
