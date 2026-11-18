/**
 * Byte-level prefilter for JSONL search.
 *
 * Decoding every line to a UTF-16 string and folding it code point by code point is what makes
 * a full-text scan of a 1 GB file take seconds, while almost every line is not a hit. For a
 * needle made only of ASCII, a line can contain a match only if its BYTES contain the needle
 * with ASCII letters compared case-insensitively, so one pass over the raw window finds the
 * candidate lines and only those are decoded and judged by the real matcher
 * (`findCaseInsensitive`). The prefilter never decides a hit; it may only over-approximate.
 *
 * Why an ASCII needle can be searched in bytes:
 *  - the UTF-8 decoder never swallows an ASCII byte (an invalid sequence becomes U+FFFD and the
 *    next ASCII byte is decoded as itself), so the ASCII characters of a decoded line are
 *    exactly its ASCII bytes, in order, and a run of them is a run of bytes;
 *  - the matcher folds an ASCII haystack character with `A-Z` -> `a-z` only;
 *  - a non-ASCII haystack character can take part in a match against an ASCII needle only if
 *    its lowercase form starts with an ASCII character. In Unicode exactly two do:
 *    U+212A KELVIN SIGN (lowercase "k") and U+0130 (lowercase "i" + U+0307). The first can
 *    stand in for any `k` of the needle; the second only for the LAST character of the needle,
 *    because the combining mark that follows `i` can never equal an ASCII needle character.
 *    A line holding either of them is therefore a candidate whenever the needle could use it.
 *
 * A needle that is not ASCII, or that contains a newline (a byte match could then straddle two
 * lines), gets no byte needle and keeps the decode-every-line path.
 */

/** `A-Z` -> `a-z`, every other byte unchanged. */
const FOLD = new Uint8Array(256);
for (let byte = 0; byte < 256; byte++) {
  FOLD[byte] = byte >= 65 && byte <= 90 ? byte + 32 : byte;
}

/** UTF-8 of U+212A KELVIN SIGN. */
const KELVIN = [0xe2, 0x84, 0xaa];
/** UTF-8 of U+0130 LATIN CAPITAL LETTER I WITH DOT ABOVE. */
const DOTTED_I = [0xc4, 0xb0];

export interface ByteNeedle {
  /** The folded needle as bytes (all < 0x80, no `A-Z`). */
  readonly pattern: Uint8Array;
  /** Horspool shift per (folded) haystack byte. */
  readonly shift: Uint8Array | Int32Array;
  /** The needle contains `k`, which U+212A also matches. */
  readonly kelvin: boolean;
  /** The needle ends with `i`, which U+0130 also matches. */
  readonly dottedI: boolean;
}

/**
 * Bytes for a needle from `foldNeedle`, or `undefined` when the byte path may not be used:
 * a non-ASCII character, or `\n`.
 */
export function byteNeedle(needle: string): ByteNeedle | undefined {
  const length = needle.length;
  if (length === 0) return undefined;
  const pattern = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    const unit = needle.charCodeAt(i);
    if (unit >= 0x80 || unit === 0x0a) return undefined;
    // The caller folds the needle; an upper-case letter here would never match anything.
    if (unit >= 65 && unit <= 90) return undefined;
    pattern[i] = unit;
  }
  const shift = length < 256 ? new Uint8Array(256).fill(length) : new Int32Array(256).fill(length);
  for (let i = 0; i < length - 1; i++) shift[pattern[i]] = length - 1 - i;
  return {
    pattern,
    shift,
    kelvin: needle.includes("k"),
    dottedI: needle.charCodeAt(length - 1) === 0x69,
  };
}

/**
 * Lines `[firstLine, lastLine)` of a window that may contain the needle, ascending, as absolute
 * line numbers. `offsets` is the file's line index and `base` the file offset of `bytes[0]`.
 */
export function candidateLines(
  bytes: Uint8Array,
  offsets: ArrayLike<number>,
  firstLine: number,
  lastLine: number,
  base: number,
  needle: ByteNeedle,
): number[] {
  const found = searchPattern(bytes, offsets, firstLine, lastLine, base, needle);
  const extra: number[] = [];
  if (needle.kelvin) scanSequence(bytes, offsets, firstLine, lastLine, base, KELVIN, extra);
  if (needle.dottedI) scanSequence(bytes, offsets, firstLine, lastLine, base, DOTTED_I, extra);
  if (extra.length === 0) return found;
  const merged = mergeAscending(found, extra);
  // Dedup: scanSequence calls append to the same extra array, so a line with both Kelvin and İ
  // appears twice. mergeAscending only removes adjacent duplicates, so use Set for full dedup.
  return [...new Set(merged)].sort((a, b) => a - b);
}

/** Horspool over the folded haystack; one hit per line, then the search resumes at the next. */
function searchPattern(
  bytes: Uint8Array,
  offsets: ArrayLike<number>,
  firstLine: number,
  lastLine: number,
  base: number,
  needle: ByteNeedle,
): number[] {
  const { pattern, shift } = needle;
  const length = pattern.length;
  const tail = length - 1;
  const tailByte = pattern[tail];
  const lines: number[] = [];
  const limit = bytes.length - length;
  let line = firstLine;
  let position = 0;
  while (position <= limit) {
    const folded = FOLD[bytes[position + tail]];
    if (folded === tailByte) {
      let k = tail - 1;
      while (k >= 0 && FOLD[bytes[position + k]] === pattern[k]) k--;
      if (k < 0) {
        while (line + 1 < lastLine && offsets[line + 1] - base <= position) line++;
        lines.push(line);
        if (line + 1 >= lastLine) break;
        position = offsets[line + 1] - base;
        continue;
      }
    }
    position += shift[folded];
  }
  return lines;
}

/** Lines that contain the UTF-8 byte sequence `sequence`, appended in ascending order. */
function scanSequence(
  bytes: Uint8Array,
  offsets: ArrayLike<number>,
  firstLine: number,
  lastLine: number,
  base: number,
  sequence: readonly number[],
  out: number[],
): void {
  let line = firstLine;
  let from = 0;
  for (;;) {
    const at = bytes.indexOf(sequence[0], from);
    if (at < 0) return;
    from = at + 1;
    let same = at + sequence.length <= bytes.length;
    for (let k = 1; same && k < sequence.length; k++) same = bytes[at + k] === sequence[k];
    if (!same) continue;
    while (line + 1 < lastLine && offsets[line + 1] - base <= at) line++;
    if (out[out.length - 1] !== line) out.push(line);
  }
}

function mergeAscending(a: number[], b: number[]): number[] {
  const merged: number[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    const next = j >= b.length || (i < a.length && a[i] <= b[j]) ? a[i++] : b[j++];
    if (merged[merged.length - 1] !== next) merged.push(next);
  }
  return merged;
}
