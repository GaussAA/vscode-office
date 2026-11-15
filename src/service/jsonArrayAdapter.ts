/**
 * JSON array adapter: provides search functionality for JSON array documents.
 *
 * Records are array elements; search uses case-insensitive matching without creating lowercase copies.
 */
import { JSON_SEARCH_BATCH, JSON_SEARCH_MAX_MATCHES } from "@/common/jsonPreviewTypes";
import type { JsonRecordRange } from "@/service/jsonPreview";
import {
  caseInsensitiveIndexOf,
  matchSnippet,
  type CancelToken,
  type RecordRange,
  type SearchOptions,
} from "@/service/recordAddressableDocument";

interface JsonSearchRecord extends RecordRange {
  count: number;
}

function previewText(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}…`;
}

function utf8Size(text: string): number {
  return new TextEncoder().encode(text).length;
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
    options: SearchOptions<JsonSearchRecord>,
    cancelToken: CancelToken,
  ): void {
    const needle = query.trim().toLowerCase();

    if (!needle) {
      options.onBatch({
        requestId,
        query,
        records: [],
        scanned: 0,
        total: this.text.length,
        matches: 0,
        done: true,
        capped: false,
      });
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
      // Use 'records' field for the generic SearchBatch interface
      options.onBatch({
        requestId,
        query,
        records: pending,
        scanned: Math.floor((processedRecords / this.records.length) * this.text.length),
        total: this.text.length,
        matches,
        done,
        capped,
      });
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
          const size = utf8Size(raw);
          const rawPreview = previewText(raw, 400);
          pending.push({
            index,
            size,
            raw: rawPreview,
            snippet: firstSnippet,
            count: recordMatches,
          });

          if (pending.length >= batchSize) {
            flush(false);
          }
        }
      }

      processedRecords = batchEnd;

      if (capped || processedRecords >= this.records.length || cancelToken.cancelled) {
        flush(true);
        return;
      }

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
