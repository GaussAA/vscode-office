/**
 * Excel viewer surface state: which top-level view to render.
 *
 * The grid mounts unconditionally (the session effect needs its container), so "grid" means
 * "show the grid and optionally the readonly banner / find panel". Priority ordering when
 * multiple conditions could theoretically be true: loading > error > guard > window > grid.
 */

export type ExcelSurface = "loading" | "error" | "guard" | "window" | "grid";

export interface ExcelSurfaceInput {
  loading: boolean;
  loadError: string | null;
  tooLarge: boolean;
  windowSource: unknown;
}

export function computeExcelSurface(input: ExcelSurfaceInput): ExcelSurface {
  if (input.loading) return "loading";
  if (input.loadError) return "error";
  if (input.tooLarge) return "guard";
  if (input.windowSource) return "window";
  return "grid";
}
