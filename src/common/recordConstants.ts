/**
 * Record limits and search constants shared by JSON Preview and JSONL viewer.
 *
 * These values govern both formats: a JSONL line and a JSON array element are both "records"
 * subject to the same byte cap, text bounds, and search budgets. Keeping them in one place
 * ensures consistency and makes future adjustments atomic (ADR-0030).
 */

/** Maximum bytes of a single record before showing as raw text instead of parsed tree. */
export const RECORD_MAX_BYTES = 8 * 1024 * 1024;

/** Maximum text characters kept for a record (the raw text behind the value panel). */
export const MAX_TEXT_CHARS = 1_000_000;

/**
 * Characters of a value summary — the one number behind every single-line preview: tree rows,
 * the detail header, the Raw tab, directory labels and search snippets.
 */
export const SUMMARY_CHARS = 120;

/**
 * Characters the value panel's body may render. It is the only full-text channel, so the budget
 * is generous; `Copy value` is never bounded by it.
 */
export const VALUE_PANEL_MAX_CHARS = 4_000_000;

/** Records/entries per search result message. */
export const SEARCH_BATCH = 200;

/** Maximum matches before capping a search. */
export const SEARCH_MAX_MATCHES = 10_000;
