import { useCallback } from "react";
import { Button } from "antd";
import type { App } from "antd";
import type Spreadsheet from "./x-spreadsheet/index";
import type { CsvEncoding } from "./csvEncoding";
import { t } from "./excel_i18n";
import { chooseExcelSaveRoute } from "./excelSave";
import { exportWorkbook, hasFormattingChanged } from "./excel_writer";

import type { ExcelSession, DirtyEffect } from "./excelSession";

// Helper to safely extract error message
const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return String(error);
};

type SaveModal = ReturnType<typeof App.useApp>["modal"];

interface UseExcelSaveArgs {
  spreadsheetRef: { current: Spreadsheet | null };
  readOnlyRef: { current: boolean };
  extRef: { current: string };
  csvEncodingRef: { current: CsvEncoding };
  csvDelimiterRef: { current: string };
  initialFormattingRef: { current: string };
  session: ExcelSession;
  applyDirtyEffect: (effect: DirtyEffect) => void;
  onSaveAs: () => void;
  modal: SaveModal;
}

/**
 * The save half of the Excel document. The viewer supplies the document refs and the Save As
 * dialog opener; this module owns the format-loss branch, the exports and the "posted, not
 * written" flag that keeps dirty state honest until the host confirms.
 */
export function useExcelSave({
  spreadsheetRef,
  readOnlyRef,
  extRef,
  csvEncodingRef,
  csvDelimiterRef,
  initialFormattingRef,
  session,
  applyDirtyEffect,
  onSaveAs,
  modal,
}: UseExcelSaveArgs) {
  const handleSave = useCallback(async () => {
    const spreadSheet = spreadsheetRef.current;
    if (!spreadSheet) return;
    const route = chooseExcelSaveRoute({
      readOnly: readOnlyRef.current,
      ext: extRef.current,
      formattingChanged: hasFormattingChanged(initialFormattingRef.current, spreadSheet.getData()),
    });
    if (route === "save-as") {
      onSaveAs();
      return;
    }

    const csvEncoding = csvEncodingRef.current;
    const csvDelimiter = csvDelimiterRef.current;
    if (route === "format-confirm") {
      await new Promise<void>((resolve) => {
        const dialog = modal.confirm({
          title: t("viewer.formatCannotPreserveTitle"),
          content: t(
            "viewer.formatCannotPreserveContent",
            extRef.current.replace(/^\./, "").toUpperCase(),
          ),
          okText: t("viewer.saveAsXlsx"),
          cancelText: t("button.cancel"),
          centered: true,
          getContainer: () => document.body,
          onOk: async () => {
            try {
              exportWorkbook(spreadSheet, ".xlsx", {
                mode: "saveAs",
                csvEncoding,
                csvDelimiter,
              });
            } catch (error) {
              console.error(`Failed to save Excel file: ${getErrorMessage(error)}`);
              throw error;
            }
          },
          onCancel: () => {},
          footer: () => (
            <>
              <Button
                style={{ padding: "3px 12px", height: "auto" }}
                onClick={() => dialog.destroy()}
              >
                {t("button.cancel")}
              </Button>
              <Button
                style={{ padding: "3px 12px", height: "auto" }}
                onClick={() => {
                  void (async () => {
                    dialog.destroy();
                    try {
                      const effect = session.markSaveRequested();
                      applyDirtyEffect(effect);
                      exportWorkbook(spreadSheet, extRef.current, {
                        mode: "save",
                        csvEncoding,
                        csvDelimiter,
                      });
                    } catch (error) {
                      console.error(`Failed to save Excel file: ${getErrorMessage(error)}`);
                    }
                  })();
                }}
              >
                {t("viewer.saveAsOriginal")}
              </Button>
              <Button
                type="primary"
                style={{ padding: "3px 12px", height: "auto" }}
                onClick={() => {
                  void (async () => {
                    try {
                      dialog.destroy();
                      exportWorkbook(spreadSheet, ".xlsx", {
                        mode: "saveAs",
                        csvEncoding,
                        csvDelimiter,
                      });
                    } catch (error) {
                      console.error(`Failed to save Excel file: ${getErrorMessage(error)}`);
                    }
                  })();
                }}
              >
                {t("viewer.saveAsXlsx")}
              </Button>
            </>
          ),
          afterClose: () => resolve(),
        });
      });
      return;
    }

    try {
      const effect = session.markSaveRequested();
      applyDirtyEffect(effect);
      exportWorkbook(spreadSheet, extRef.current, {
        mode: "save",
        csvEncoding,
        csvDelimiter,
      });
    } catch (error) {
      console.error(`Failed to save Excel file: ${getErrorMessage(error)}`);
    }
  }, [
    applyDirtyEffect,
    csvDelimiterRef,
    csvEncodingRef,
    extRef,
    initialFormattingRef,
    modal,
    onSaveAs,
    readOnlyRef,
    session,
    spreadsheetRef,
  ]);

  const confirmSaveAs = useCallback(
    async (format: string) => {
      const spreadSheet = spreadsheetRef.current;
      if (!spreadSheet) return;
      try {
        exportWorkbook(spreadSheet, format, {
          mode: "saveAs",
          csvEncoding: csvEncodingRef.current,
          csvDelimiter: csvDelimiterRef.current,
        });
        // Save As writes a different file; the document being edited is still dirty.
      } catch (error) {
        console.error(`Failed to save Excel file: ${getErrorMessage(error)}`);
      }
    },
    [csvDelimiterRef, csvEncodingRef, spreadsheetRef],
  );

  return { handleSave, confirmSaveAs };
}
