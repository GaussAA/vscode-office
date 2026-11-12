import type { SheetView } from "./sheetView";

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
  return /\.(xlsx|xlsm|xls|ods)$/i.test(ext) ? "workbook" : "text";
}

export type ExcelWorkbookParser = "legacy" | "exceljs";

/** ExcelJS reads xlsx/xlsm; SheetJS has to handle the legacy `.xls` and `.ods` containers. */
export function excelWorkbookParser(ext: string): ExcelWorkbookParser {
  return /\.(xls|ods)$/i.test(ext) ? "legacy" : "exceljs";
}
