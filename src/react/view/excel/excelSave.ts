export type ExcelSaveRoute = "save-as" | "format-confirm" | "direct";

interface SaveRouteInput {
  readOnly: boolean;
  ext: string;
  formattingChanged: boolean;
}

/**
 * What Ctrl+S should do for this document. Kept pure so the data-critical branch does not have
 * to be inferred from the modal code: a read-only grid always detours through Save As, a format
 * that cannot carry formatting asks before writing, and everything else saves in place.
 */
export function chooseExcelSaveRoute({
  readOnly,
  ext,
  formattingChanged,
}: SaveRouteInput): ExcelSaveRoute {
  if (readOnly) return "save-as";
  const normalized = ext.replace(/^\./, "").toLowerCase();
  if (normalized !== "xlsx" && normalized !== "xlsm" && formattingChanged) {
    return "format-confirm";
  }
  return "direct";
}
