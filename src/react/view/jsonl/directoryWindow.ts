/**
 * The JSONL directory is one contiguous window, not a map plus a range. Two regressions came
 * from letting those disagree: a late reply extended the end without filling the middle, and a
 * superseded replace repainted the pane after a newer jump had already moved it. This module
 * owns the window invariants; the viewer owns transport and selection.
 */
export interface DirectoryWindow<T> {
  start: number;
  end: number;
  items: T[];
}

export interface WindowReply<T> {
  start: number;
  items: T[];
}

export function emptyDirectoryWindow<T>(): DirectoryWindow<T> {
  return { start: 0, end: 0, items: [] };
}

/** Keep the target row inside a chunk-sized window, clamped to the document. */
export function recenterWindow(
  target: number,
  lineCount: number,
  chunkSize: number,
): { start: number; end: number } {
  const size = Math.max(1, chunkSize);
  const begin = Math.max(0, Math.min(target - 100, Math.max(0, lineCount - size)));
  return { start: begin, end: Math.min(lineCount, begin + size) };
}

/**
 * Apply an index reply. A replace is authoritative only when it is still the newest request;
 * an append is valid only when it starts exactly where the current window ends.
 */
export function applyWindowReply<T>(
  state: DirectoryWindow<T>,
  reply: WindowReply<T>,
  mode: "replace" | "append",
  isNewest: boolean,
): DirectoryWindow<T> {
  if (reply.items.length === 0) return state;
  const end = reply.start + reply.items.length;
  if (mode === "replace") {
    return isNewest ? { start: reply.start, end, items: reply.items } : state;
  }
  if (reply.start !== state.end) return state;
  return { start: state.start, end, items: [...state.items, ...reply.items] };
}

export function windowNeedsMore<T>(state: DirectoryWindow<T>, lineCount: number): boolean {
  return state.end < lineCount;
}
