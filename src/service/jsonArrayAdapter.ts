/**
 * JSON array adapter: provides search functionality for JSON array documents.
 *
 * Records are array elements; search uses case-insensitive matching without creating lowercase copies.
 */
import {
  JSON_SEARCH_BATCH,
  JSON_SEARCH_CHAR_BUDGET,
  JSON_SEARCH_MAX_MATCHES,
  type JsonSearchBatch,
} from "@/common/jsonPreviewTypes";
import type { JsonRecordRange } from "@/service/jsonPreview";
import type { CancelToken, SearchOptions } from "@/service/recordAddressableDocument";
import { findCaseInsensitive, foldNeedle, matchSnippet } from "@/service/recordAddressableDocument";

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
    const needle = foldNeedle(query);

    if (!needle) {
      const emptyBatch: JsonSearchBatch = {
        requestId,
        query,
        records: [],
        scanned: this.text.length,
        total: this.text.length,
        matches: 0,
        done: true,
        capped: false,
      };
      options.onBatch(emptyBatch);
      return;
    }

    const schedule = options.schedule ?? ((run) => setTimeout(run, 0));
    const batchSize = options.batchSize ?? JSON_SEARCH_BATCH;
    const maxMatches = options.maxMatches ?? JSON_SEARCH_MAX_MATCHES;
    const step = options.step ?? 1000;

    let scanned = 0; // character offset reached so far
    let processedRecords = 0;
    let matches = 0;
    let capped = false;
    let pending: JsonSearchRecord[] = [];

    const flush = (done: boolean) => {
      const batch: JsonSearchBatch = {
        requestId,
        query,
        records: pending.map((r) => ({ index: r.index, count: r.count, snippet: r.snippet })),
        scanned,
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

      const recordLimit = Math.min(processedRecords + step, this.records.length);
      let charsRead = 0;

      for (
        ;
        processedRecords < recordLimit && !cancelToken.cancelled && !capped;
        processedRecords++
      ) {
        const range = this.records[processedRecords];
        const recordSize = range.end - range.start;

        // Apply character budget: if adding this record would exceed the budget and we've
        // already read something this turn, defer it to the next turn.
        if (charsRead > 0 && charsRead + recordSize > JSON_SEARCH_CHAR_BUDGET) {
          break;
        }

        const raw = this.text.slice(range.start, range.end);
        charsRead += recordSize;
        scanned = range.end;

        let cursor = 0;
        let recordMatches = 0;
        let firstSnippet: string | null = null;

        // Find all matches in this record using case-insensitive search
        while (cursor < raw.length) {
          const found = findCaseInsensitive(raw, needle, cursor);
          if (!found) break;

          if (recordMatches === 0) {
            // Capture snippet from first match
            firstSnippet = matchSnippet(raw, needle);
          }

          recordMatches++;
          matches++;
          cursor = Math.max(found.end, found.start + 1);

          if (matches >= maxMatches) {
            capped = true;
            break;
          }
        }

        if (recordMatches > 0 && firstSnippet) {
          pending.push({
            index: processedRecords,
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

      if (cancelToken.cancelled) {
        // Exit without sending any batch after cancellation
        return;
      }

      if (capped || processedRecords >= this.records.length) {
        scanned = this.text.length;
        flush(true);
        return;
      }

      // Always flush after a turn, even with no matches, so scanned advances
      flush(false);
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
