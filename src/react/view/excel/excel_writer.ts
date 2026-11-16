import { handler } from "../../util/vscode";
import type Spreadsheet from "./x-spreadsheet/index";
import type { CsvEncoding } from "./csvEncoding";
import { saveMessage } from "./workbookBytes";

// Re-export formatting utilities from excel_meta
export { buildFormattingSnapshot, hasFormattingChanged } from "./excel_meta";

export interface ExportOptions {
  /** `save` overwrites the open document; `saveAs` asks the host for a new file. */
  mode: "save" | "saveAs";
  csvEncoding?: CsvEncoding;
  csvDelimiter?: string;
}

/**
 * Serialize the grid as `ext` and post it to the host. Both Save and Save As go through
 * `saveMessage`, so the bytes written for a given extension are the same on either path.
 * Throws for an extension that is not a spreadsheet format instead of writing xlsx bytes.
 */
export function exportWorkbook(spreadSheet: Spreadsheet, ext: string, options: ExportOptions) {
  const { type, payload } = saveMessage(spreadSheet.getData(), ext, options.mode, options);
  handler.emit(type, payload);
}
