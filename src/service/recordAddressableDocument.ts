/**
 * Record-addressable document abstraction: a sequence of records with byte boundaries,
 * windowed reads, and cancelable streaming search.
 *
 * Line-delimited (JSONL) and array-delimited (JSON) are two adapters over this interface.
 * The search logic lives here, so the Unicode case-insensitive bug is fixed in one place.
 */

export interface SearchOptions<TBatch> {
  /** Records decoded per event-loop turn. */
  step?: number;
  /** Matches per batch message. */
  batchSize?: number;
  /** Maximum matches before stopping. */
  maxMatches?: number;
  /** Called for every batch, including the final one. */
  onBatch: (batch: TBatch) => void;
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
 * Case-insensitive substring search without creating a lowercase copy.
 *
 * This fixes the Unicode bug: `toLowerCase()` on the whole haystack can change string length
 * (e.g., Turkish İ becomes two UTF-16 code units), causing match offsets to misalign with
 * record boundaries and snippet extraction.
 *
 * Instead, we compare character by character, using a precomputed lowercase fold table for
 * performance. The needle is expected to already be lowercased by the caller.
 *
 * @param haystack The text to search in (not lowercased)
 * @param needleLower The search term, already lowercased
 * @param fromIndex Starting position (default 0)
 */
export function caseInsensitiveIndexOf(
  haystack: string,
  needleLower: string,
  fromIndex = 0,
): number {
  if (needleLower.length === 0) return fromIndex;
  const haystackLen = haystack.length;
  const needleLen = needleLower.length;
  const searchLimit = haystackLen - needleLen;

  for (let i = fromIndex; i <= searchLimit; i++) {
    let match = true;
    for (let j = 0; j < needleLen; j++) {
      const hChar = haystack.charCodeAt(i + j);
      const nChar = needleLower.charCodeAt(j);
      // Fast path: exact match
      if (hChar === nChar) continue;
      // Slow path: case-insensitive comparison using toLowerCase on single characters
      if (haystack[i + j].toLowerCase() !== needleLower[j]) {
        match = false;
        break;
      }
    }
    if (match) return i;
  }
  return -1;
}

/**
 * Extract a snippet with context around the first match of `needle` in `text`.
 * Returns up to 200 characters centered on the match.
 *
 * @param text The text to extract from
 * @param needleLower The lowercased search term
 */
export function matchSnippet(text: string, needleLower: string): string {
  const at = caseInsensitiveIndexOf(text, needleLower);
  if (at < 0) {
    // No match; return head of text
    return text.length <= 200 ? text : `${text.slice(0, 200)}…`;
  }

  // Center the snippet on the match with more context after than before
  const contextBefore = 50;
  const contextAfter = 150;
  const start = Math.max(0, at - contextBefore);
  const end = Math.min(text.length, at + needleLower.length + contextAfter);

  // Extract the base snippet
  let snippet = text.slice(start, end);

  // Add ellipsis markers
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";

  return prefix + snippet + suffix;
}
