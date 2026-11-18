/**
 * Per-webview memo for completed windowed-sheet finds.
 *
 * The windowed path has no in-memory sheet: each find streams row blocks from the source, so
 * repeating a query re-reads the file. The memo stores only the matching row indexes (numbers,
 * no cell values) for the last few queries; it never leaves the webview and is cleared with the
 * unified Clear command. The key is case-folded because row search is case-insensitive.
 */
export interface WindowedFindResult {
  rows: number[];
  capped: boolean;
}

export const WINDOWED_FIND_MEMO_ENTRIES = 3;

const memo = new Map<string, WindowedFindResult>();

export function windowedFindMemoKey(query: string): string {
  return query.trim().toLocaleLowerCase();
}

export function getWindowedFindMemo(query: string): WindowedFindResult | null {
  return memo.get(windowedFindMemoKey(query)) ?? null;
}

export function setWindowedFindMemo(query: string, result: WindowedFindResult): void {
  const key = windowedFindMemoKey(query);
  memo.delete(key);
  memo.set(key, result);
  while (memo.size > WINDOWED_FIND_MEMO_ENTRIES) {
    const oldest = memo.keys().next().value;
    if (oldest === undefined) break;
    memo.delete(oldest);
  }
}

export function clearWindowedFindMemo(): void {
  memo.clear();
}
