/**
 * Which view a spreadsheet gets (phase 2 of ADR-0017).
 *
 * Two paths, one decision: the editable `x-spreadsheet` grid for normal files, and a read-only
 * windowed table once a text file is big enough that the full parse (one object per cell) is the
 * problem. Keeping the rule in one tested place means the viewer cannot drift from the ADR, and
 * the README's "large files are read-only" claim has a single source of truth.
 */
import { isOverPreviewLimit, previewLimitBytes } from "@/common/previewLimit";
import { kindOf } from "./sheetKind";

/** Above this, CSV/TSV are rendered by the windowed view instead of parsed into cells. */
export const WINDOW_THRESHOLD_BYTES = 8 * 1024 * 1024;

/**
 * Sanity bound for the windowed text path. The windowed view cannot die on a *parse* — it reads
 * one block — so the only remaining cost is the file bytes plus 8 bytes of offset per row. This
 * is where that stops being reasonable, not where a performance cliff is.
 *
 * 350 MB is chosen to stay within the CSV index cache limit (16 MB per file): a 350 MB CSV
 * produces ~14.5 MB of index data (record starts array), which fits in the cache and avoids
 * re-scanning on every open. Larger files would exceed the cache cap and trigger a 3+ second
 * synchronous scan every time. Going beyond 350 MB requires async chunked indexing with progress
 * reporting (similar to ADR-0024's approach for JSONL), which is deferred to future work.
 */
export const TEXT_WINDOW_MAX_BYTES = 350 * 1024 * 1024;

/** Text formats windowed when large. */
const WINDOW_EXTENSIONS = new Set([".csv", ".tsv"]);
/** Workbooks (all use SheetJS now): windowing fixes memory/rendering, not parse time. */
const WORKBOOK_EXTENSIONS = new Set([".xlsx", ".xlsm", ".xls", ".ods"]);

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
  const normalized = kindOf(ext);
  if (!normalized) {
    // Unknown extension: apply default preview limit
    return !size || size <= 0 || !isOverPreviewLimit(ext, size) ? "grid" : "refused";
  }
  if (!size || size <= 0) return "grid";
  if (WINDOW_EXTENSIONS.has(normalized)) {
    const limit = options.virtual ? previewLimitBytes(normalized) : TEXT_WINDOW_MAX_BYTES;
    if (size > limit) return "refused";
    return size > WINDOW_THRESHOLD_BYTES ? "window" : "grid";
  }
  if (WORKBOOK_EXTENSIONS.has(normalized)) {
    if (isOverPreviewLimit(normalized, size)) return "refused";
    return size > WINDOW_THRESHOLD_BYTES ? "window" : "grid";
  }
  return isOverPreviewLimit(normalized, size) ? "refused" : "grid";
}
/** The size the refusal panel compares against, so its message matches the decision above. */
export function limitForView(ext: string, options: SheetViewOptions = {}): number {
  const normalized = kindOf(ext);
  if (normalized && WINDOW_EXTENSIONS.has(normalized) && !options.virtual) {
    return TEXT_WINDOW_MAX_BYTES;
  }
  return previewLimitBytes(ext);
}
