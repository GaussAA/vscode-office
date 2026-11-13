/**
 * The one place that spells a page range.
 *
 * The bottom bar and the screen-reader announcement must say the same thing: two spellings of
 * "where am I" is exactly the kind of drift nobody notices until a support question.
 */
export function formatRowRange(start: number, loaded: number, total: number): string {
  if (total === 0) return "";
  const from = start + 1;
  const to = Math.min(total, start + loaded);
  return `${from.toLocaleString()}–${to.toLocaleString()} of ${total.toLocaleString()}`;
}
