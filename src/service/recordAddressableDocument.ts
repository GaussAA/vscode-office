/**
 * Record-addressable document abstraction: a sequence of records with byte boundaries,
 * windowed reads, and cancelable streaming search.
 *
 * Line-delimited (JSONL) and array-delimited (JSON) are two adapters over this interface.
 * The search logic lives here, so the Unicode case-insensitive bug is fixed in one place.
 */

/** Batch size for streaming search results. */
export const SEARCH_BATCH = 200;

/** Maximum matches before capping a search. */
export const MAX_MATCHES = 10_000;

/** Maximum bytes of a single record before showing as raw text instead of parsed tree. */
export const RECORD_MAX_BYTES = 8 * 1024 * 1024;

/** Maximum text characters kept for a record. */
export const MAX_TEXT_CHARS = 1_000_000;

export interface RecordRange {
  /** Zero-based record index. */
  index: number;
  /** UTF-8 byte size of the record. */
  size: number;
  /** Truncated raw text preview. */
  raw: string;
  /** Search snippet around the match, if applicable. */
  snippet?: string;
}

export interface SearchBatch<T extends RecordRange> {
  requestId: number;
  query: string;
  /** Matches found in this batch. */
  records: T[];
  /** Bytes or characters scanned so far. */
  scanned: number;
  /** Total bytes or characters to scan. */
  total: number;
  /** Total matches found so far. */
  matches: number;
  /** True on the final batch. */
  done: boolean;
  /** True when stopped due to MAX_MATCHES. */
  capped: boolean;
}

export interface SearchOptions<T extends RecordRange> {
  /** Records decoded per event-loop turn. */
  step?: number;
  /** Matches per batch message. */
  batchSize?: number;
  /** Maximum matches before stopping. */
  maxMatches?: number;
  /** Called for every batch, including the final one. */
  onBatch: (batch: SearchBatch<T>) => void;
  /** Injected scheduler for tests; defaults to setTimeout. */
  schedule?: (run: () => void) => void;
}

export interface CancelToken {
  cancel(): void;
  readonly cancelled: boolean;
}

export function createCancelToken(): CancelToken & { check(): boolean } {
  let active = true;
  return {
    cancel() {
      active = false;
    },
    get cancelled() {
      return !active;
    },
    check() {
      return active;
    },
  };
}

/**
 * A document that can be addressed by record index, read in windows, and searched with
 * cancelable streaming.
 */
export interface RecordAddressableDocument<T extends RecordRange> {
  /** Total number of records. */
  readonly recordCount: number;

  /**
   * Read a window of records from `start` (inclusive) to `end` (exclusive).
   * Returns summaries with index, size, and preview text.
   */
  readRecords(start: number, end: number): Promise<T[]>;

  /**
   * Search the entire document for `query` (case-insensitive substring), streaming results
   * in batches. Returns a cancel token to stop the scan early.
   */
  search(
    requestId: number,
    query: string,
    options: SearchOptions<T>,
    cancelToken: CancelToken,
  ): void;

  /** Clean up resources. */
  dispose?(): void;
}

/**
 * Case-insensitive substring search without creating a lowercase copy.
 *
 * This fixes the Unicode bug: `toLowerCase()` can change string length (e.g., Turkish İ
 * becomes two UTF-16 code units), causing match offsets to misalign with record boundaries.
 *
 * Instead, we compare character by character in a case-insensitive way.
 */
export function caseInsensitiveIndexOf(haystack: string, needle: string, fromIndex = 0): number {
  if (needle.length === 0) return fromIndex;
  const haystackLen = haystack.length;
  const needleLen = needle.length;
  const searchLimit = haystackLen - needleLen;

  for (let i = fromIndex; i <= searchLimit; i++) {
    let match = true;
    for (let j = 0; j < needleLen; j++) {
      const hChar = haystack.charCodeAt(i + j);
      const nChar = needle.charCodeAt(j);
      // Fast path: exact match
      if (hChar === nChar) continue;
      // Slow path: case-insensitive comparison using toLowerCase on single characters
      if (haystack[i + j].toLowerCase() !== needle[j].toLowerCase()) {
        match = false;
        break;
      }
    }
    if (match) return i;
  }
  return -1;
}

/**
 * Generic streaming search implementation that works on any text-based record sequence.
 *
 * @param getText - Returns the full text for a record index.
 * @param makeRecord - Constructs a search result record from index and snippet.
 * @param total - Total units to scan (for progress reporting).
 * @param recordCount - Total number of records.
 */
export async function streamingSearch<T extends RecordRange>(
  requestId: number,
  query: string,
  options: SearchOptions<T>,
  cancelToken: CancelToken,
  getText: (index: number) => Promise<string>,
  makeRecord: (index: number, snippet: string, count: number) => T,
  total: number,
  recordCount: number,
): Promise<void> {
  const batchSize = options.batchSize ?? SEARCH_BATCH;
  const maxMatches = options.maxMatches ?? MAX_MATCHES;
  const schedule = options.schedule ?? ((run) => setTimeout(run, 0));
  const needle = query.trim().toLowerCase();

  if (!needle) {
    options.onBatch({
      requestId,
      query,
      records: [],
      scanned: 0,
      total,
      matches: 0,
      done: true,
      capped: false,
    });
    return;
  }

  let scanned = 0;
  let matches = 0;
  let capped = false;
  let pending: T[] = [];

  // Track first match per record and total hit count in that record
  const firstMatch = new Map<number, { record: T; count: number }>();

  const flush = (done: boolean) => {
    options.onBatch({
      requestId,
      query,
      records: pending,
      scanned,
      total,
      matches,
      done,
      capped,
    });
    pending = [];
  };

  const processRecord = async (index: number): Promise<boolean> => {
    if (cancelToken.cancelled) return false;

    const text = await getText(index);
    let cursor = 0;
    let recordMatches = 0;
    let firstSnippet: string | null = null;

    // Find all matches in this record
    while (cursor < text.length) {
      const at = caseInsensitiveIndexOf(text, needle, cursor);
      if (at < 0) break;

      if (recordMatches === 0) {
        // Capture snippet from first match
        const snippetStart = Math.max(0, at - 50);
        const snippetEnd = Math.min(text.length, at + needle.length + 150);
        firstSnippet = text.slice(snippetStart, snippetEnd);
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
      const record = makeRecord(index, firstSnippet, recordMatches);
      firstMatch.set(index, { record, count: recordMatches });
      pending.push(record);

      if (pending.length >= batchSize) {
        flush(false);
      }
    }

    return !capped;
  };

  // Process records in chunks to keep responsive
  const CHUNK_SIZE = 1000;
  for (let i = 0; i < recordCount && !cancelToken.cancelled && !capped; i += CHUNK_SIZE) {
    const chunkEnd = Math.min(i + CHUNK_SIZE, recordCount);

    for (let j = i; j < chunkEnd && !cancelToken.cancelled && !capped; j++) {
      const shouldContinue = await processRecord(j);
      if (!shouldContinue) break;
    }

    scanned = Math.min(total, Math.floor((chunkEnd / recordCount) * total));

    // Yield control to avoid blocking
    if (chunkEnd < recordCount && !cancelToken.cancelled && !capped) {
      await new Promise<void>((resolve) => schedule(resolve));
    }
  }

  if (!cancelToken.cancelled) {
    scanned = total;
    flush(true);
  }
}

/**
 * Extract a snippet with context around the first match of `needle` in `text`.
 * Returns up to 200 characters centered on the match.
 */
export function matchSnippet(text: string, needle: string): string {
  const at = caseInsensitiveIndexOf(text, needle);
  if (at < 0) {
    // No match; return head of text
    return text.length <= 200 ? text : `${text.slice(0, 200)}…`;
  }

  // Center the snippet on the match with more context after than before
  const contextBefore = 50;
  const contextAfter = 150;
  const start = Math.max(0, at - contextBefore);
  const end = Math.min(text.length, at + needle.length + contextAfter);

  // Extract the base snippet
  let snippet = text.slice(start, end);

  // Add ellipsis markers
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";

  return prefix + snippet + suffix;
}
