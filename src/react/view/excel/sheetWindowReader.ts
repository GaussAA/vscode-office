/**
 * Reads the rows a windowed grid is about to show (phase 2 of ADR-0017).
 *
 * A scroll handler fires per pixel, and a naive wiring would call `source.readRows` every time.
 * Worse, `visibleRange` grows by a row on almost every pixel (the last visible row changes), so
 * even "same page" scrolling asks for a new range constantly. Two things here fix that:
 *
 *  - reads are quantised to fixed row blocks, so a pixel scroll inside a block costs nothing;
 *  - a block serves any range inside it, and only the newest request may answer — the same
 *    stale-result lesson `ParquetSession` learned for its prefetch.
 */
import type { SheetSource } from "./sheetSource";
import { visibleRange, type SheetViewport, type VisibleRange } from "./sheetWindow";

/** Rows per read. 64 covers ~2.7 screens at 24px rows, so a page-down usually stays inside. */
export const WINDOW_BLOCK_ROWS = 64;

export interface SheetWindowSnapshot {
  rows: string[][];
  range: VisibleRange;
  /** True when a newer request superseded this one; the caller must ignore it. */
  stale: boolean;
}

export interface SheetWindowReader {
  rowsFor(scrollTop: number, viewport: SheetViewport): Promise<SheetWindowSnapshot>;
  /** Rows already in hand for this offset, without waiting; undefined when none match. */
  peek(scrollTop: number, viewport: SheetViewport): string[][] | undefined;
}

interface Block {
  start: number;
  end: number;
}

export function createSheetWindowReader(source: SheetSource): SheetWindowReader {
  const totalRows = source.rowCount;
  let cached: Block | undefined;
  let cachedRows: string[][] = [];
  let sequence = 0;

  const blockFor = (range: VisibleRange): Block => {
    const start = Math.max(0, Math.floor(range.start / WINDOW_BLOCK_ROWS) * WINDOW_BLOCK_ROWS);
    const end = Math.min(
      totalRows,
      Math.ceil(Math.max(range.end, range.start + 1) / WINDOW_BLOCK_ROWS) * WINDOW_BLOCK_ROWS,
    );
    return { start, end };
  };

  const covered = (block: Block, range: VisibleRange) =>
    block.start <= range.start && range.end <= block.end;

  /** Rows for `range` from the cached block, or undefined when the block does not cover it. */
  const sliceCached = (range: VisibleRange): string[][] | undefined => {
    if (!cached || !covered(cached, range)) return undefined;
    return cachedRows.slice(range.start - cached.start, range.end - cached.start);
  };

  return {
    async rowsFor(scrollTop, viewport) {
      const range = visibleRange(scrollTop, viewport);
      const cachedSlice = sliceCached(range);
      if (cachedSlice) return { rows: cachedSlice, range, stale: false };

      const ticket = ++sequence;
      const block = blockFor(range);
      let rows: string[][];
      try {
        rows = await source.readRows(block.start, block.end);
      } catch (error) {
        if (ticket !== sequence) return { rows: [], range, stale: true };
        throw error;
      }
      if (ticket !== sequence) return { rows: [], range, stale: true };
      cached = block;
      cachedRows = rows;
      return {
        rows: rows.slice(range.start - block.start, range.end - block.start),
        range,
        stale: false,
      };
    },

    peek(scrollTop, viewport) {
      return sliceCached(visibleRange(scrollTop, viewport));
    },
  };
}
