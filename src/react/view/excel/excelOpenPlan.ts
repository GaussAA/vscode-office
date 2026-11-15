import type { SheetView } from "./sheetView";
import { kindOf, viewFor } from "./sheetKind";

export type ExcelOpenPlan = "guard" | "load";

interface ExcelOpenPlanInput {
  forced: boolean;
  tooLarge: boolean | undefined;
  view: SheetView;
}

/**
 * Whether an incoming document may be read. "Open anyway" only suppresses the current payload's
 * guard; a later document starts guarded again.
 */
export function planExcelOpen({ forced, tooLarge, view }: ExcelOpenPlanInput): ExcelOpenPlan {
  return !forced && (tooLarge || view === "refused") ? "guard" : "load";
}

export type ExcelWindowKind = "workbook" | "text";

/** A windowed payload is either a workbook (sheet picker) or a plain text source. */
export function excelWindowKind(ext: string): ExcelWindowKind {
  const normalized = kindOf(ext);
  if (!normalized) return "text";
  return viewFor(normalized) === "windowed" ? "workbook" : "text";
}
