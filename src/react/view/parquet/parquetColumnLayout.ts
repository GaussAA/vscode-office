import { COLUMN_STRETCH_MAX, INDEX_COLUMN_WIDTH } from "./parquetLayout";

export interface ParquetColumnLayout {
  widths: number[];
  filler: number;
  extent: number;
}

/**
 * Turn the user's column widths into the widths the grid renders.
 *
 * Columns grow to use spare room, but never past `COLUMN_STRETCH_MAX`, and the growth is
 * uniform. When the cap is reached the table stops short and the surface's own background shows
 * through; whatever rc-table would otherwise redistribute is handed to a filler column.
 */
export function computeParquetColumnLayout(
  widths: number[],
  tableBodyWidth: number,
): ParquetColumnLayout {
  const baseSum = widths.reduce((sum, width) => sum + width, 0);
  const available = Math.max(0, tableBodyWidth - INDEX_COLUMN_WIDTH);
  if (widths.length === 0 || available <= baseSum) {
    return { widths, filler: 0, extent: INDEX_COLUMN_WIDTH + baseSum };
  }
  const growth = widths.map((width) => Math.max(0, COLUMN_STRETCH_MAX - width));
  const capacity = growth.reduce((sum, room) => sum + room, 0);
  if (capacity === 0) {
    // Every column is already at the cap. The leftover still needs a filler: rc-table forces
    // the table to 100% of its container, and without one it would quietly grow these columns
    // past the cap anyway.
    return {
      widths,
      filler: Math.max(0, tableBodyWidth - (INDEX_COLUMN_WIDTH + baseSum)),
      extent: INDEX_COLUMN_WIDTH + baseSum,
    };
  }
  const share = Math.min(1, (available - baseSum) / capacity);
  const grown = widths.map((width, index) => Math.round(width + growth[index] * share));
  const grownSum = grown.reduce((sum, width) => sum + width, 0);
  return {
    widths: grown,
    filler: Math.max(0, tableBodyWidth - (INDEX_COLUMN_WIDTH + grownSum)),
    extent: INDEX_COLUMN_WIDTH + grownSum,
  };
}
