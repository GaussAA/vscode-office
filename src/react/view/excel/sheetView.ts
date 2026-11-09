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

/**
 * Sanity bound for the windowed text path. The windowed view cannot die on a *parse* — it reads
 * one block — so the only remaining cost is the file bytes plus 8 bytes of offset per row. This
 * is where that stops being reasonable, not where a performance cliff is.
 */
export const TEXT_WINDOW_MAX_BYTES = 200 * 1024 * 1024;

/** The windowed view renders text formats only; workbooks need the store from phase 4. */
const WINDOW_EXTENSIONS = new Set([".csv", ".tsv"]);

export interface SheetViewOptions {
  /**
   * A virtual document (GitHub Repos, `git:` history) crosses the webview bridge inline, so the
   * 25 MB guard still applies to it even though the windowed view could render more.
   */
  virtual?: boolean;
}

export type SheetView = "grid" | "window" | "refused";

/**
 * Pick the view for a spreadsheet.
 *
 * - `refused`: over a limit — the user has to ask before anything is read.
 * - `window`: text format above the window threshold — read-only, viewport rows only.
 * - `grid`: everything else, including workbooks of any size the guard allows.
 *
 * The guards differ by *why* they exist: a workbook is refused at 15 MB because parsing it means
 * one cell object per value (ADR-0016), while a local text file only pays for its own bytes in
 * the windowed view and is therefore allowed up to `TEXT_WINDOW_MAX_BYTES`. A virtual text file
 * keeps the 25 MB guard because crossing the bridge inline is the expensive part there.
 */
export function sheetViewFor(
  ext: string,
  size: number | undefined,
  options: SheetViewOptions = {},
): SheetView {
  const lower = (ext ?? "").toLowerCase();
  if (!size || size <= 0) return "grid";
  if (WINDOW_EXTENSIONS.has(lower)) {
    const limit = options.virtual ? previewLimitBytes(lower) : TEXT_WINDOW_MAX_BYTES;
    if (size > limit) return "refused";
    return size > WINDOW_THRESHOLD_BYTES ? "window" : "grid";
  }
  return isOverPreviewLimit(lower, size) ? "refused" : "grid";
}

/** The size the refusal panel compares against, so its message matches the decision above. */
export function limitForView(ext: string, options: SheetViewOptions = {}): number {
  const lower = (ext ?? "").toLowerCase();
  if (WINDOW_EXTENSIONS.has(lower) && !options.virtual) return TEXT_WINDOW_MAX_BYTES;
  return previewLimitBytes(lower);
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
