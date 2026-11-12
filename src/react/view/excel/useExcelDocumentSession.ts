import { useCallback, useEffect, useRef, useState } from "react";
import type { App } from "antd";
import { handler } from "../../util/vscode.ts";
import { loadOfficeBuffer } from "../../util/loadOfficeContent.ts";
import type { OfficeOpenMessage } from "@/common/openPayload";
import { loadLegacyWorkbookRows, loadSheets, loadWorkbookRows } from "./excel_reader";
import { buildFormattingSnapshot } from "./excel_writer";
import type Spreadsheet from "./x-spreadsheet/index";
import { t } from "./excel_i18n";
import { createTextSheetSource, type SheetSource } from "./sheetSource";
import { createWorkbookSheetSource, type WorkbookSheetSource } from "./workbookSource";
import { limitForView, sheetViewFor } from "./sheetView";
import type { ExcelTooLarge } from "./ExcelGuard";
import { useExcelSave } from "./useExcelSave";
import { mountExcelSpreadsheet } from "./excelSpreadsheetHost";

export type ExcelOpenPayload = OfficeOpenMessage;

/** Bump a generation ref from an effect cleanup without touching it directly there. */
function invalidateOpen(ref: { current: number }) {
  ref.current += 1;
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
 * One document's open/guard/load/save session. It owns the payload lifetime, the generation
 * fence, the spreadsheet host and the save state; the viewer is left with theme, find-panel
 * mounting and the windowed/grid choice's rendered output.
 */
export function useExcelDocumentSession({
  message,
  modal,
  onFind,
  onResetFind,
}: UseExcelDocumentSessionArgs) {
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
  const documentCacheIdRef = useRef("");
  const readOnlyRef = useRef(false);
  const spreadSheetRef = useRef<Spreadsheet | null>(null);
  const csvEncodingRef = useRef<"utf8" | "gbk">("utf8");
  const csvDelimiterRef = useRef(",");
  const initialFormattingRef = useRef("");
  const forcedRef = useRef(false);
  const pendingPayloadRef = useRef<ExcelOpenPayload | null>(null);
  const loadPayloadRef = useRef<((payload: ExcelOpenPayload, seq: number) => void) | null>(null);
  const openSeqRef = useRef(0);
  const gridReadyRef = useRef(false);
  const pendingSaveRef = useRef(false);

  const handleAutoFitColumns = useCallback(() => {
    const spreadSheet = spreadSheetRef.current;
    if (!spreadSheet || !gridReadyRef.current) return;
    spreadSheet.autoFitColumns();
    if (!readOnlyRef.current) {
      spreadSheet.setSaveEnabled(true);
      handler.emit("change");
    }
    message.success({
      duration: 1.5,
      content: t("viewer.autoFitDone"),
      className: "excel-save-success-message",
    });
  }, [message]);

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
    pendingSaveRef,
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
    const payload = pendingPayloadRef.current;
    if (!payload) return;
    forcedRef.current = true;
    setTooLarge(null);
    setLoadError(null);
    setLoading(true);
    const seq = ++openSeqRef.current;
    if (payload.scheme === "file" || payload.bufferBase64 || payload.buffer?.length) {
      loadPayloadRef.current?.(payload, seq);
      return;
    }
    handler.emit("openForce");
  }, []);

  useEffect(() => {
    const container = document.getElementById("container");
    if (!container) return;
    let activeHost: ReturnType<typeof mountExcelSpreadsheet> | null = null;

    const initSpreadsheet = async (buffer: ArrayBuffer, payload: ExcelOpenPayload, seq: number) => {
      const fileReadOnly = payload.readOnly === true;
      const { sheets, maxLength, maxCols, csvDelimiter, csvEncoding } = await loadSheets(
        buffer,
        payload.ext,
      );
      if (seq !== openSeqRef.current) return;
      if (csvDelimiter) csvDelimiterRef.current = csvDelimiter;
      if (csvEncoding) csvEncodingRef.current = csvEncoding;
      container.innerHTML = "";
      const host = mountExcelSpreadsheet({
        container,
        sheets,
        ext: payload.ext ?? "",
        readOnly: fileReadOnly,
        documentKey: documentCacheIdRef.current,
        maxLength,
        maxCols,
        handlers: {
          onAutoFit: handleAutoFitColumns,
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

    const loadPayload = (payload: ExcelOpenPayload, seq: number) => {
      setWindowSource(null);
      void loadOfficeBuffer(payload)
        .then(async (buffer) => {
          if (seq !== openSeqRef.current) return;
          try {
            const view = sheetViewFor(payload.ext ?? "", payload.size, {
              virtual: payload.scheme !== "file",
            });
            if (view === "window") {
              if (/\.(xlsx|xlsm|xls|ods)$/i.test(payload.ext ?? "")) {
                const legacy = /\.(xls|ods)$/i.test(payload.ext ?? "");
                const rows = legacy
                  ? await loadLegacyWorkbookRows(buffer)
                  : await loadWorkbookRows(buffer);
                if (seq !== openSeqRef.current) return;
                const source = createWorkbookSheetSource(rows);
                workbookRef.current = source;
                setSheetNames(source.sheetNames);
                setActiveSheet(source.sheetIndex);
                setWindowSource(source);
              } else {
                workbookRef.current = null;
                setSheetNames([]);
                setActiveSheet(0);
                setWindowSource(createTextSheetSource(buffer));
              }
              setWindowLoad((load) => load + 1);
              setLoadError(null);
              setLoading(false);
              return;
            }
            await initSpreadsheet(buffer, payload, seq);
          } catch (e) {
            if (seq !== openSeqRef.current) return;
            const msg = (e as Error).message || String(e);
            console.error(`Failed to load Excel file: ${msg}`, e);
            setLoadError(msg);
            setLoading(false);
          }
        })
        .catch((error) => {
          if (seq !== openSeqRef.current) return;
          const msg = (error as Error).message || String(error);
          console.error(`Failed to load Excel file: ${msg}`, error);
          setLoadError(msg);
          setLoading(false);
        });
    };
    loadPayloadRef.current = loadPayload;

    handler
      .on("open", (payload: ExcelOpenPayload) => {
        activeHost?.dispose();
        activeHost = null;
        const seq = ++openSeqRef.current;
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
        const nextCacheId = payload.documentCacheId ?? "";
        if (nextCacheId !== documentCacheIdRef.current) {
          forcedRef.current = false;
        }
        documentCacheIdRef.current = nextCacheId;
        extRef.current = payload.ext ?? "";
        const fileReadOnly = payload.readOnly === true;
        readOnlyRef.current = fileReadOnly;
        setReadOnly(fileReadOnly);
        pendingPayloadRef.current = payload;
        const view = sheetViewFor(payload.ext ?? "", payload.size, {
          virtual: payload.scheme !== "file",
        });
        if (!forcedRef.current && (payload.tooLarge || view === "refused")) {
          setTooLarge({
            size: payload.size ?? 0,
            name: payload.fileName ?? "",
            ext: payload.ext ?? "",
            limit: limitForView(payload.ext ?? "", { virtual: payload.scheme !== "file" }),
          });
          setLoading(false);
          return;
        }
        loadPayload(payload, seq);
      })
      .on("saveDone", () => {
        if (!pendingSaveRef.current) return;
        pendingSaveRef.current = false;
        spreadSheetRef.current?.setSaveEnabled(false);
      })
      .emit("init");

    let themeTimer: ReturnType<typeof setTimeout>;
    const themeObserver = new MutationObserver(() => {
      clearTimeout(themeTimer);
      themeTimer = setTimeout(() => spreadSheetRef.current?.reRender(), 120);
    });
    themeObserver.observe(document.head, { childList: true, subtree: true });

    return () => {
      activeHost?.dispose();
      invalidateOpen(openSeqRef);
      gridReadyRef.current = false;
      pendingSaveRef.current = false;
      spreadSheetRef.current = null;
      setActiveSpreadsheet(null);
      themeObserver.disconnect();
      clearTimeout(themeTimer);
    };
    // `handleAutoFitColumns` is deliberately omitted: this effect boots the spreadsheet and
    // calls emit('init'), so re-running it when that callback's identity changes would
    // re-initialise the whole sheet. It is stable enough that the stale closure is safe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleSave, handleSaveAs, message, onFind, onResetFind]);

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
    spreadSheetRef,
    readOnlyRef,
    fileName: pendingPayloadRef.current?.fileName ?? "",
  };
}
