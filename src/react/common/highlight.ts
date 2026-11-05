/**
 * Search highlighting, shared by every webview view that marks matches in place.
 *
 * There used to be two copies: the parquet table capped its marks at 20, the JSONL list at
 * 40 runs, and they disagreed about both the cap and the return shape. Each view keeps its
 * own `<mark>` class; the split is decided here once.
 */

export interface TextRun {
    text: string;
    hit: boolean;
}

/**
 * Cap on the number of runs. Both copies guarded against pathological input (a one-character
 * needle in a long string) and stopped marking after the cap; beyond it the rest of the text
 * is emitted as a single unmatched run.
 */
export const MAX_HIGHLIGHT_RUNS = 40;

export function highlightRuns(text: string, needle?: string): TextRun[] {
    if (!needle) return [{ text, hit: false }];
    const lower = text.toLowerCase();
    const query = needle.toLowerCase();
    const parts: TextRun[] = [];
    let cursor = 0;
    while (cursor < text.length && parts.length < MAX_HIGHLIGHT_RUNS) {
        const at = lower.indexOf(query, cursor);
        if (at < 0) break;
        if (at > cursor) parts.push({ text: text.slice(cursor, at), hit: false });
        parts.push({ text: text.slice(at, at + query.length), hit: true });
        cursor = at + query.length;
    }
    if (cursor < text.length) parts.push({ text: text.slice(cursor), hit: false });
    return parts.length ? parts : [{ text, hit: false }];
}
