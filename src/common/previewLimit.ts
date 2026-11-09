/**
 * Where "preview it" stops being a good idea for a spreadsheet.
 *
 * Measured on the built viewer (numbers in `docs/agents/perf.md`): a 152 MB CSV took 9.7 s
 * and 1.36 GB of JS heap before the first cell painted, and a 19 MB workbook took 10 s. Peak
 * memory is roughly 9x the file size, so the wall is the renderer process, not patience — the
 * webview is a browser tab and it dies the way one does.
 *
 * The limits are deliberately generous (a 20 MB CSV still opens in ~2 s) and they are
 * enforced at both ends: the host refuses to read an oversized *virtual* document into a
 * `postMessage` payload, and the webview refuses to parse an oversized *local* file until the
 * user says so. One module, so the two ends cannot disagree about the number.
 */
export const SPREADSHEET_PREVIEW_LIMITS = {
  /** CSV/TSV: plain text, turned into one object per cell at roughly 9x the bytes. */
  text: 25 * 1024 * 1024,
  /** xlsx/xlsm/xls/ods: zip + shared strings + styles, the most expensive path per byte. */
  workbook: 15 * 1024 * 1024,
} as const;

export type SpreadsheetKind = keyof typeof SPREADSHEET_PREVIEW_LIMITS;

/**
 * Parquet is gated only when it has to travel inline.
 *
 * A local parquet is paged with `Range` requests, so its size is irrelevant to the viewer —
 * only the footer and the row group in view are read. A *virtual* document (GitHub Repos, a
 * `git:` history entry) cannot be fetched by the webview, so the host sends the whole file as
 * one base64 string and the viewer keeps it in memory: at 4/3 inflation plus the decoded
 * buffer, 50 MB is where that stops being a couple of seconds.
 */
export const PARQUET_PREVIEW_LIMIT = 50 * 1024 * 1024;

/** Extensions include the dot, because that is what `extname` and the payload both carry. */
const TEXT_EXTENSIONS = new Set([".csv", ".tsv"]);
const WORKBOOK_EXTENSIONS = new Set([".xlsx", ".xlsm", ".xls", ".ods"]);

export function spreadsheetKind(ext: string | undefined): SpreadsheetKind | null {
  const lower = (ext ?? "").toLowerCase();
  if (TEXT_EXTENSIONS.has(lower)) return "text";
  if (WORKBOOK_EXTENSIONS.has(lower)) return "workbook";
  return null;
}

/** Infinity for anything this module does not know: unstaged formats are never refused. */
export function previewLimitBytes(ext: string | undefined): number {
  if ((ext ?? "").toLowerCase() === ".parquet") return PARQUET_PREVIEW_LIMIT;
  const kind = spreadsheetKind(ext);
  return kind ? SPREADSHEET_PREVIEW_LIMITS[kind] : Number.POSITIVE_INFINITY;
}

/** True only when a size is actually known and over the limit for that extension. */
export function isOverPreviewLimit(
  ext: string | undefined,
  size: number | undefined | null,
): boolean {
  if (!size || size <= 0) return false;
  const limit = previewLimitBytes(ext);
  return Number.isFinite(limit) && size > limit;
}

/**
 * "18.4 MB" for display.
 *
 * One decimal is enough to decide whether to open a file, and the value is compared against a
 * binary limit, so it uses binary units rather than pretending to be SI.
 */
export function formatBytes(bytes: number | undefined | null): string {
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  const megabytes = bytes / (1024 * 1024);
  if (megabytes < 1) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${megabytes.toFixed(1)} MB`;
}
