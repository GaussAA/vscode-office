/**
 * Which view a spreadsheet gets (phase 2 of ADR-0017).
 *
 * Two paths, one decision: the editable `x-spreadsheet` grid for normal files, and a read-only
 * windowed table once a text file is big enough that the full parse (one object per cell) is the
 * problem. Keeping the rule in one tested place means the viewer cannot drift from the ADR, and
 * the README's "large files are read-only" claim has a single source of truth.
 */
import { isOverPreviewLimit, previewLimitBytes } from "@/common/previewLimit";

/** Above this, CSV/TSV are rendered by the windowed view instead of parsed into cells. */
export const WINDOW_THRESHOLD_BYTES = 8 * 1024 * 1024;

/** The windowed view renders text formats only; workbooks need the store from phase 4. */
const WINDOW_EXTENSIONS = new Set([".csv", ".tsv"]);

export type SheetView = "grid" | "window" | "refused";

/**
 * Pick the view for a spreadsheet.
 *
 * - `refused`: over the size guard (ADR-0016) — the user has to ask before anything is read.
 * - `window`: text format above the window threshold — read-only, viewport rows only.
 * - `grid`: everything else, including workbooks of any size the guard allows.
 */
export function sheetViewFor(ext: string, size: number | undefined): SheetView {
  const lower = (ext ?? "").toLowerCase();
  if (isOverPreviewLimit(lower, size)) return "refused";
  if (!size || size <= WINDOW_THRESHOLD_BYTES) return "grid";
  return WINDOW_EXTENSIONS.has(lower) ? "window" : "grid";
}

/** True when the chosen view must show the size guard instead of content. */
export function isRefusedView(ext: string, size: number | undefined): boolean {
  return isOverPreviewLimit(ext, size);
}

/**
 * The cell text the windowed table shows.
 *
 * Long values are cut instead of wrapped: a windowed row has a fixed height, and one giant
 * cell must not stretch it (the full value is reachable by widening the column or opening the
 * file in the text editor).
 */
export function cellText(value: string | undefined, max = 200): string {
  if (!value) return "";
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/** Header labels, padded to the grid's column count so every cell has a column. */
export function headerCells(rows: string[][], columnCount: number): string[] {
  const first = rows[0] ?? [];
  const labels: string[] = [];
  for (let column = 0; column < columnCount; column++) {
    labels.push(cellText(first[column]) || String(column + 1));
  }
  return labels;
}

/** The size the guard compares against, for the refusal panel. */
export function limitFor(ext: string): number {
  return previewLimitBytes(ext);
}
