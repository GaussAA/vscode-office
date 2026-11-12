export type ExcelColorMode = "adaptive" | "light";

export interface ExcelViewState {
  ri: number;
  ci: number;
  sheetIndex: number;
}

export function parseExcelColorMode(raw: string | null): ExcelColorMode | null {
  return raw === "light" || raw === "adaptive" ? raw : null;
}

/**
 * Validate a stored view before it reaches the vendored grid. A malformed or partial entry used
 * to flow through `Math.max` and become `NaN`, which `scrollToCell` cannot recover from.
 */
export function parseExcelViewState(raw: string | null): ExcelViewState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const { ri, ci, sheetIndex } = parsed as Partial<ExcelViewState>;
    if (
      typeof ri !== "number" ||
      typeof ci !== "number" ||
      typeof sheetIndex !== "number" ||
      !Number.isFinite(ri) ||
      !Number.isFinite(ci) ||
      !Number.isFinite(sheetIndex)
    ) {
      return null;
    }
    return {
      ri: Math.max(0, Math.trunc(ri)),
      ci: Math.max(0, Math.trunc(ci)),
      sheetIndex: Math.max(0, Math.trunc(sheetIndex)),
    };
  } catch {
    return null;
  }
}
