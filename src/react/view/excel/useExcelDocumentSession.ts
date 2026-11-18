import { useCallback, useEffect, useRef, useState } from "react";
import type { App } from "antd";
import { handler } from "../../util/vscode.ts";
import { loadOfficeBuffer } from "../../util/loadOfficeContent.ts";
import { loadSheets, loadWorkbookRows } from "./excel_reader";
import { buildFormattingSnapshot } from "./excel_writer";
import type Spreadsheet from "./x-spreadsheet/index";
import { t } from "./excel_i18n";
import type { SheetSource } from "./sheetSource";
import type { WorkbookSheetSource } from "./workbookSource";
import {
  ExcelSession,
  loadErrorMessage,
  type ExcelLoadDeps,
  type ExcelOpenPayload,
  type ExcelTooLarge,
} from "./excelSession";
import { useExcelSave } from "./useExcelSave";
import { mountExcelSpreadsheet } from "./excelSpreadsheetHost";
import { clearExcelViewStorage } from "./excelViewState";
import { clearWindowedFindMemo } from "./windowedFindMemo";

export type { ExcelOpenPayload };

const LOAD_DEPS: ExcelLoadDeps = {
  loadBuffer: loadOfficeBuffer,
  loadWorkbookRows,
  loadSheets,
};

/**
 * Call `onChange` once, `delayMs` after the last change to `<head>` (the VS Code theme swaps
 * stylesheets there). Returns the function that stops watching. The timer lives in a helper
 * so the hook itself never reassigns a variable after render.
 */
function watchHeadChanges(onChange: () => void, delayMs: number): () => void {
  const timer: { id?: ReturnType<typeof setTimeout> } = {};
  const observer = new MutationObserver(() => {
    clearTimeout(timer.id);
    timer.id = setTimeout(onChange, delayMs);
  });
  observer.observe(document.head, { childList: true, subtree: true });
  return () => {
    observer.disconnect();
    clearTimeout(timer.id);
  };
}

interface UseExcelDocumentSessionArgs {
  message: ReturnType<typeof App.useApp>["message"];
  modal: ReturnType<typeof App.useApp>["modal"];
  /** Ctrl+F / the spreadsheet Find button; the viewer owns the find panel. */
  onFind: () => void;
  /** Clear the find panel when a new document arrives. */
  onResetFind: () => void;
}

/**
 * Adapter between one `ExcelSession` (the open/guard/load decisions and the generation fence)
 * and React: it applies the session's outcomes to state, owns the spreadsheet host and the
 * save state, and talks to the vscode bridge. The viewer is left with theme, find-panel
 * mounting and the windowed/grid choice's rendered output.
 */
export function useExcelDocumentSession({
  message,
  modal,
  onFind,
  onResetFind,
}: UseExcelDocumentSessionArgs) {
  const [session] = useState(() => new ExcelSession());
  const [loading, setLoading] = useState(true);
  const [readOnly, setReadOnly] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tooLarge, setTooLarge] = useState<ExcelTooLarge | null>(null);
  const [windowSource, setWindowSource] = useState<SheetSource | null>(null);
  const workbookRef = useRef<WorkbookSheetSource | null>(null);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [activeSheet, setActiveSheet] = useState(0);
  const [windowLoad, setWindowLoad] = useState(0);
  const [saveAsVisible, setSaveAsVisible] = useState(false);
  const [activeSpreadsheet, setActiveSpreadsheet] = useState<Spreadsheet | null>(null);
  const extRef = useRef("");
  const readOnlyRef = useRef(false);
  const spreadSheetRef = useRef<Spreadsheet | null>(null);
  const csvEncodingRef = useRef<"utf8" | "gbk">("utf8");
  const csvDelimiterRef = useRef(",");
  const initialFormattingRef = useRef("");
  const loadPayloadRef = useRef<((payload: ExcelOpenPayload, seq: number) => void) | null>(null);
  const gridReadyRef = useRef(false);
  // Dirty-state effects: apply save-enabled and notify host
  const applyDirtyEffect = useCallback(
    (effect: { saveEnabled: boolean; notifyHost: "dirty" | "clean" | null }) => {
      const spreadSheet = spreadSheetRef.current;
      if (spreadSheet && gridReadyRef.current) {
        spreadSheet.setSaveEnabled(effect.saveEnabled);
      }
      // Host manages its own clean state via editVersion check, so only notify on dirty
      if (effect.notifyHost === "dirty") {
        handler.emit("change");
      }
    },
    [],
  );

  const handleEdited = useCallback(() => {
    const effect = session.markEdited();
    applyDirtyEffect(effect);
  }, [session, applyDirtyEffect]);

  const handleAutoFitColumns = useCallback(() => {
    const spreadSheet = spreadSheetRef.current;
    if (!spreadSheet || !gridReadyRef.current) return;
    spreadSheet.autoFitColumns();
    const effect = session.markEdited();
    applyDirtyEffect(effect);
    message.success({
      duration: 1.5,
      content: t("viewer.autoFitDone"),
      className: "excel-save-success-message",
    });
  }, [message, session, applyDirtyEffect]);

  const handleSaveAs = useCallback(() => {
    setSaveAsVisible(true);
  }, []);

  const { handleSave, confirmSaveAs } = useExcelSave({
    spreadsheetRef: spreadSheetRef,
    readOnlyRef,
    extRef,
    csvEncodingRef,
    csvDelimiterRef,
    initialFormattingRef,
    session,
    applyDirtyEffect,
    onSaveAs: handleSaveAs,
    modal,
  });

  const handleSelectSheet = useCallback((index: number) => {
    const source = workbookRef.current;
    if (!source) return;
    const next = source.selectSheet(index);
    workbookRef.current = next;
    setWindowSource(next);
    setActiveSheet(next.sheetIndex);
    setWindowLoad((load) => load + 1);
  }, []);

  const handleOpenAnyway = useCallback(() => {
    const result = session.openAnyway();
    if (!result) return;
    setTooLarge(null);
    setLoadError(null);
    setLoading(true);
    if (result.kind === "load") {
      loadPayloadRef.current?.(result.payload, result.seq);
      return;
    }
    handler.emit("openForce");
  }, [session]);

  useEffect(() => {
    const container = document.getElementById("container");
    if (!container) return;
    let activeHost: ReturnType<typeof mountExcelSpreadsheet> | null = null;

    const failLoad = (errorMessage: string, cause: unknown) => {
      console.error(`Failed to load Excel file: ${errorMessage}`, cause);
      setLoadError(errorMessage);
      setLoading(false);
    };

    const mountGrid = (data: Awaited<ReturnType<typeof loadSheets>>, payload: ExcelOpenPayload) => {
      const { sheets, maxLength, maxCols, csvDelimiter, csvEncoding } = data;
      if (csvDelimiter) csvDelimiterRef.current = csvDelimiter;
      if (csvEncoding) csvEncodingRef.current = csvEncoding;
      container.innerHTML = "";
      const host = mountExcelSpreadsheet({
        container,
        sheets,
        ext: payload.ext ?? "",
        readOnly: payload.readOnly === true,
        documentKey: session.documentCacheId,
        maxLength,
        maxCols,
        handlers: {
          onAutoFit: handleAutoFitColumns,
          onEdited: handleEdited,
          onSave: () => void handleSave(),
          onSaveAs: handleSaveAs,
          onEditInVSCode: () => handler.emit("editInVSCode", true),
          onFind,
          onOpenExternal: (url) => handler.emit("openExternal", url),
          onProtectedCell: () => {
            message.info({
              duration: 2,
              content: t("viewer.protectedCell"),
              className: "excel-protected-cell-message",
            });
          },
          onValidationError: (errMessage) => {
            message.warning({
              duration: 2,
              content: errMessage,
              className: "excel-validation-error-message",
            });
          },
        },
      });
      activeHost = host;
      spreadSheetRef.current = host.spreadSheet;
      gridReadyRef.current = true;
      setActiveSpreadsheet(host.spreadSheet);
      setLoadError(null);
      setLoading(false);
      initialFormattingRef.current = buildFormattingSnapshot(host.spreadSheet.getData());
    };

    const showWindow = () => {
      setWindowLoad((load) => load + 1);
      setLoadError(null);
      setLoading(false);
    };

    const loadPayload = (payload: ExcelOpenPayload, seq: number) => {
      setWindowSource(null);
      void session.load(payload, seq, LOAD_DEPS).then((outcome) => {
        switch (outcome.kind) {
          case "stale":
            return;
          case "error":
            failLoad(outcome.message, outcome.cause);
            return;
          case "workbook":
            workbookRef.current = outcome.source;
            setSheetNames(outcome.source.sheetNames);
            setActiveSheet(outcome.source.sheetIndex);
            setWindowSource(outcome.source);
            showWindow();
            return;
          case "text":
            workbookRef.current = null;
            setSheetNames([]);
            setActiveSheet(0);
            setWindowSource(outcome.source);
            showWindow();
            return;
          case "grid":
            try {
              mountGrid(outcome.data, payload);
            } catch (cause) {
              if (!session.isCurrent(seq)) return;
              failLoad(loadErrorMessage(cause), cause);
            }
            return;
        }
      });
    };
    loadPayloadRef.current = loadPayload;

    handler
      .on("open", (payload: ExcelOpenPayload) => {
        if (payload.clearCache) {
          clearExcelViewStorage();
          clearWindowedFindMemo();
        }
        activeHost?.dispose();
        activeHost = null;
        const result = session.open(payload);
        setLoading(true);
        setLoadError(null);
        setTooLarge(null);
        setWindowSource(null);
        onResetFind();
        gridReadyRef.current = false;
        spreadSheetRef.current = null;
        setActiveSpreadsheet(null);
        workbookRef.current = null;
        setSheetNames([]);
        setActiveSheet(0);
        document.getElementById("container")?.replaceChildren();
        extRef.current = payload.ext ?? "";
        const fileReadOnly = payload.readOnly === true;
        readOnlyRef.current = fileReadOnly;
        setReadOnly(fileReadOnly);
        if (result.kind === "guard") {
          setTooLarge(result.tooLarge);
          setLoading(false);
          return;
        }
        loadPayload(result.payload, result.seq);
      })
      .on("clearExcelCache", () => {
        clearExcelViewStorage();
        clearWindowedFindMemo();
        onResetFind();
        spreadSheetRef.current?.scrollToCell(0, 0, 0);
      })
      .on("saveDone", () => {
        const effect = session.markSaveDone();
        applyDirtyEffect(effect);
      })
      .on("saveFailed", (payload: { reason?: string; message?: string } | undefined) => {
        const effect = session.markSaveFailed();
        applyDirtyEffect(effect);
        modal.error({
          title: t("viewer.saveFailed"),
          content: payload?.message || "The save operation failed. Please try again.",
        });
      })
      .emit("init");

    const stopThemeWatch = watchHeadChanges(() => spreadSheetRef.current?.reRender(), 120);

    return () => {
      activeHost?.dispose();
      session.invalidate();
      gridReadyRef.current = false;
      spreadSheetRef.current = null;
      setActiveSpreadsheet(null);
      stopThemeWatch();
    };
  }, [
    applyDirtyEffect,
    handleAutoFitColumns,
    handleEdited,
    handleSave,
    handleSaveAs,
    message,
    modal,
    onFind,
    onResetFind,
    session,
  ]);

  return {
    loading,
    readOnly,
    loadError,
    tooLarge,
    windowSource,
    sheetNames,
    activeSheet,
    windowLoad,
    activeSpreadsheet,
    saveAsVisible,
    setSaveAsVisible,
    confirmSaveAs,
    handleSave,
    handleSaveAs,
    handleAutoFitColumns,
    handleOpenAnyway,
    handleSelectSheet,
    handleEdited,
    spreadSheetRef,
    readOnlyRef,
    fileName: session.payload?.fileName ?? "",
  };
}
