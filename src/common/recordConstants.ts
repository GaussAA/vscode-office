/**
 * Record limits and search constants shared by JSON Preview and JSONL viewer.
 *
 * These values govern both formats: a JSONL line and a JSON array element are both "records"
 * subject to the same byte cap, text truncation, and search budgets. Keeping them in one place
 * ensures consistency and makes future adjustments atomic.
 */

/** Maximum bytes of a single record before showing as raw text instead of parsed tree. */
export const RECORD_MAX_BYTES = 8 * 1024 * 1024;

/** Maximum text characters kept for a record. */
export const MAX_TEXT_CHARS = 1_000_000;

/** Characters of raw text kept for a record label fallback / preview. */
export const RAW_PREVIEW_CHARS = 400;

/** Records/entries per search result message. */
export const SEARCH_BATCH = 200;

/** Maximum matches before capping a search. */
export const SEARCH_MAX_MATCHES = 10_000;
