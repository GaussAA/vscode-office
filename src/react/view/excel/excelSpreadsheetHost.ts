import { t } from "./excel_i18n";
import { handler } from "../../util/vscode.ts";
import Spreadsheet, { type SheetData } from "./x-spreadsheet/index";
import { parseSpreadsheetLink } from "./excel_hyperlink";
import { loadViewState, restoreViewState, saveViewState } from "./excelViewState";
import { MIN_VIEW_COLS, MIN_VIEW_ROWS } from "./excel_meta";

function isCsvLikeExt(ext: string): boolean {
  return /^(csv|tsv)$/i.test(ext.replace(/^\./, ""));
}

interface ExcelSpreadsheetHostHandlers {
  onAutoFit: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onEditInVSCode: () => void;
  onFind: () => void;
  onOpenExternal: (url: string) => void;
  onProtectedCell: () => void;
  onValidationError: (message: string) => void;
}

interface MountExcelSpreadsheetArgs {
  container: HTMLElement;
  sheets: SheetData[];
  ext: string;
  readOnly: boolean;
  documentKey: string;
  maxLength?: number;
  maxCols: number;
  handlers: ExcelSpreadsheetHostHandlers;
}

/**
 * Mount the vendored spreadsheet and wire its events. This is the one place that knows the
 * vendor's constructor/event API; the viewer owns loading and document lifecycle.
 */
export function mountExcelSpreadsheet({
  container,
  sheets,
  ext,
  readOnly,
  documentKey,
  maxLength,
  maxCols,
  handlers,
}: MountExcelSpreadsheetArgs) {
  const viewRowLen = Math.max(maxLength ?? 0, MIN_VIEW_ROWS);
  const viewColLen = Math.max(maxCols, MIN_VIEW_COLS);
  const spreadSheet = new Spreadsheet(container, {
    mode: readOnly ? "read" : "edit",
    showToolbar: true,
    extendToolbar: {
      right: [
        {
          tip: `${t("viewer.autoFitColumns")} (${navigator.platform.includes("Mac") ? "Cmd+Alt+0" : "Ctrl+Alt+0"})`,
          el: (() => {
            const button = document.createElement("span");
            button.textContent = "AF";
            button.className = "excel-autofit-badge";
            return button;
          })(),
          onClick: () => {
            handlers.onAutoFit();
          },
        },
      ],
    },
    showEditInVSCode: isCsvLikeExt(ext),
    row: { len: viewRowLen, height: 30 },
    col: { len: viewColLen },
    view: { height: () => window.innerHeight - 2 },
  });

  spreadSheet.loadData(sheets);

  if (!readOnly) {
    spreadSheet.on("save", handlers.onSave);
  }
  spreadSheet.on("save-as", handlers.onSaveAs);
  spreadSheet.on("edit-in-vscode", handlers.onEditInVSCode);
  spreadSheet.on("find", handlers.onFind);
  spreadSheet.onOpenLink((linkPayload) => {
    const parsed = parseSpreadsheetLink(linkPayload.link);
    if (parsed.type === "internal") {
      spreadSheet.followHyperlink(linkPayload);
    } else {
      handlers.onOpenExternal(parsed.url);
    }
  });
  spreadSheet.onProtectedCellDblClick(handlers.onProtectedCell);
  spreadSheet.onValidationError(handlers.onValidationError);
  spreadSheet.on("change", () => {
    if (!readOnly) {
      spreadSheet.setSaveEnabled(true);
      handler.emit("change");
    }
  });

  // Cell selection fires continuously while arrowing; one write per gesture is enough.
  let viewTimer: ReturnType<typeof setTimeout> | undefined;
  const persistView = () => {
    if (viewTimer) clearTimeout(viewTimer);
    viewTimer = setTimeout(() => {
      viewTimer = undefined;
      saveViewState(documentKey, spreadSheet.getSelection());
    }, 200);
  };
  spreadSheet.on("cell-selected", persistView);
  spreadSheet.onSheetChange(persistView);

  const savedView = loadViewState(documentKey);
  if (savedView) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        restoreViewState(spreadSheet, savedView);
      });
    });
  }

  return {
    spreadSheet,
    dispose() {
      if (!viewTimer) return;
      clearTimeout(viewTimer);
      saveViewState(documentKey, spreadSheet.getSelection());
    },
  };
}
