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
 * The one case-insensitive matcher for JSON and JSONL search.
 *
 * Lowercasing the haystack and searching that copy is wrong twice over: it allocates a copy of
 * a record that can be megabytes, and `toLowerCase()` can change length ("İ".toLowerCase() is two
 * UTF-16 units, "i" + U+0307), so an offset measured in the copy points somewhere else in the
 * original. Here only the needle is lowercased; the haystack is folded one code point at a time
 * while comparing, and the result is an offset into the ORIGINAL text.
 */

/** Lowercase a query the way the matcher folds haystack characters (per code point). */
export function foldNeedle(query: string): string {
  const trimmed = query.trim();
  let out = "";
  for (const char of trimmed) out += char.toLowerCase();
  return out;
}

/**
 * End offset (exclusive, in `haystack`) of a match of `needle` starting exactly at `start`,
 * or -1. `needle` must come from `foldNeedle`. A haystack character whose lowercase form is
 * longer than one unit may be consumed only partly at the end of the needle, so the query "i"
 * still finds "İ" (as a whole-line `toLowerCase().includes` did).
 */
function matchEndAt(haystack: string, start: number, needle: string): number {
  let at = start;
  let used = 0;
  const length = haystack.length;
  while (used < needle.length) {
    if (at >= length) return -1;
    const unit = haystack.charCodeAt(at);
    if (unit < 0x80) {
      const folded = unit >= 65 && unit <= 90 ? unit + 32 : unit;
      if (folded !== needle.charCodeAt(used)) return -1;
      used++;
      at++;
      continue;
    }
    const codePoint = haystack.codePointAt(at) as number;
    const lower = String.fromCodePoint(codePoint).toLowerCase();
    for (let k = 0; k < lower.length && used < needle.length; k++, used++) {
      if (lower.charCodeAt(k) !== needle.charCodeAt(used)) return -1;
    }
    at += codePoint > 0xffff ? 2 : 1;
  }
  return at;
}

export interface TextMatch {
  /** Offset of the first matched unit in the original text. */
  start: number;
  /** Offset just past the last matched unit in the original text. */
  end: number;
}

/** First match of `needle` (from `foldNeedle`) in `haystack` at or after `fromIndex`. */
export function findCaseInsensitive(
  haystack: string,
  needle: string,
  fromIndex = 0,
): TextMatch | null {
  if (needle.length === 0) return null;
  const first = needle.charCodeAt(0);
  const firstAscii = first < 0x80;
  const last = haystack.length - 1;
  for (let i = fromIndex; i <= last; i++) {
    if (firstAscii) {
      const unit = haystack.charCodeAt(i);
      if (unit < 0x80 && (unit >= 65 && unit <= 90 ? unit + 32 : unit) !== first) continue;
    }
    const end = matchEndAt(haystack, i, needle);
    if (end >= 0) return { start: i, end };
  }
  return null;
}

/** Offset of the first match, or -1. `needle` must come from `foldNeedle`. */
export function caseInsensitiveIndexOf(haystack: string, needle: string, fromIndex = 0): number {
  if (needle.length === 0) return fromIndex;
  return findCaseInsensitive(haystack, needle, fromIndex)?.start ?? -1;
}

/** A window of `text` around [start, end): `before`/`after` characters, "…" where cut. */
export function snippetAround(
  text: string,
  start: number,
  end: number,
  before: number,
  after: number,
): string {
  const from = Math.max(0, start - before);
  const to = Math.min(text.length, end + after);
  return `${from > 0 ? "…" : ""}${text.slice(from, to)}${to < text.length ? "…" : ""}`;
}

/**
 * Snippet around the first match of `needle` (from `foldNeedle`): 50 characters before and 150
 * after. Without a match it is the head of the text.
 */
export function matchSnippet(text: string, needle: string): string {
  const match = findCaseInsensitive(text, needle);
  if (!match) return text.length <= 200 ? text : `${text.slice(0, 200)}…`;
  return snippetAround(text, match.start, match.end, 50, 150);
}
