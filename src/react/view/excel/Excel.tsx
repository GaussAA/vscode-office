import { MoonOutlined, SunOutlined } from "@ant-design/icons";
import { App, Button, Modal, Radio, Spin } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import { handler, vscodeApi } from "../../util/vscode.ts";
import { isVscodeEditorDark, observeVscodeThemeChange } from "../../util/vscodeTheme.ts";
import { loadOfficeBuffer } from "../../util/loadOfficeContent.ts";
import type { OfficeOpenMessage } from "@/common/openPayload";
import { formatBytes } from "@/common/previewLimit";
import "./Excel.less";
import { MIN_VIEW_COLS, MIN_VIEW_ROWS } from "./excel_meta.ts";
import { detectCsvEncoding } from "./csvEncoding.ts";
import { loadLegacyWorkbookRows, loadSheets, loadWorkbookRows } from "./excel_reader.ts";
import {
  export_xlsx,
  exportSaveAs,
  buildFormattingSnapshot,
  hasFormattingChanged,
} from "./excel_writer.ts";
import Spreadsheet from "./x-spreadsheet/index";
import FindReplacePanel, { type FindReplacePanelHandle } from "./FindReplacePanel";
import { parseSpreadsheetLink } from "./excel_hyperlink";
import { initExcelLocale, t } from "./excel_i18n";
import WindowedSheet from "./WindowedSheet";
import { createTextSheetSource, type SheetSource } from "./sheetSource";
import { createWorkbookSheetSource, type WorkbookSheetSource } from "./workbookSource";
import { limitForView, sheetViewFor } from "./sheetView";

initExcelLocale();

type ExcelColorMode = "adaptive" | "light";

const EXCEL_COLOR_MODE_KEY = "office-excel-color-mode";

function loadExcelColorMode(): ExcelColorMode {
  const state = vscodeApi?.getState?.() as { excelColorMode?: ExcelColorMode } | undefined;
  if (state?.excelColorMode === "light" || state?.excelColorMode === "adaptive") {
    return state.excelColorMode;
  }
  try {
    const saved = localStorage.getItem(EXCEL_COLOR_MODE_KEY);
    if (saved === "light" || saved === "adaptive") {
      return saved;
    }
  } catch {}
  return "light";
}

function saveExcelColorMode(mode: ExcelColorMode) {
  try {
    localStorage.setItem(EXCEL_COLOR_MODE_KEY, mode);
  } catch {}
  if (vscodeApi?.setState) {
    const prev = (vscodeApi.getState?.() ?? {}) as Record<string, unknown>;
    vscodeApi.setState({ ...prev, excelColorMode: mode });
  }
}

type ExcelViewState = { ri: number; ci: number; sheetIndex: number };

const EXCEL_VIEW_STATE_SUFFIX = "-excel-view";

function getViewStateKey(documentCacheId: string): string {
  return `${documentCacheId}${EXCEL_VIEW_STATE_SUFFIX}`;
}

function loadViewState(documentCacheId: string): ExcelViewState | null {
  if (!documentCacheId) return null;
  const key = getViewStateKey(documentCacheId);
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as ExcelViewState;
  } catch {
    return null;
  }
}

function saveViewState(documentCacheId: string, view: ExcelViewState) {
  if (!documentCacheId) return;
  const key = getViewStateKey(documentCacheId);
  try {
    localStorage.setItem(key, JSON.stringify(view));
  } catch {
    // ignore quota / private mode errors
  }
}

function restoreViewState(spreadSheet: Spreadsheet, saved: ExcelViewState) {
  const sheets = spreadSheet.getData();
  if (!sheets.length) return;
  const sheetIndex = Math.min(Math.max(0, saved.sheetIndex), sheets.length - 1);
  // The vendored spreadsheet's SheetData type omits the grid it actually carries.
  const sheet = sheets[sheetIndex] as { rows?: { len?: number }; cols?: { len?: number } };
  const maxRi = Math.max(0, (sheet.rows?.len ?? 1) - 1);
  const maxCi = Math.max(0, (sheet.cols?.len ?? 1) - 1);
  const ri = Math.min(Math.max(0, saved.ri), maxRi);
  const ci = Math.min(Math.max(0, saved.ci), maxCi);
  spreadSheet.scrollToCell(ri, ci, sheetIndex);
}

function isCsvLikeExt(ext: string): boolean {
  return /^(csv|tsv)$/i.test(ext.replace(/^\./, ""));
}

/** What the host sends on `open`, plus the fields the size guard needs. */
type ExcelOpenPayload = OfficeOpenMessage;

function ExcelViewer() {
  const { message, modal } = App.useApp();
  const [loading, setLoading] = useState(true);
  const [colorMode, setColorMode] = useState(loadExcelColorMode);
  const [vscodeDark, setVscodeDark] = useState(isVscodeEditorDark);
  const [readOnly, setReadOnly] = useState(false);
  const [findPanel, setFindPanel] = useState<"find" | "replace" | null>(null);
  const findPanelRef = useRef<"find" | "replace" | null>(null);
  const findReplacePanelRef = useRef<FindReplacePanelHandle>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  /**
   * Set when the payload was refused by the size guard. The viewer then shows the refusal
   * instead of parsing; nothing is fetched, because the fetch is already half the cost of a
   * large CSV on a remote workspace.
   */
  const [tooLarge, setTooLarge] = useState<{
    size: number;
    name: string;
    ext: string;
    /** The limit this file missed; local text and virtual text have different ones. */
    limit: number;
  } | null>(null);
  /**
   * Set when a large text file is shown as a read-only window instead of the editable grid.
   * `null` means the grid path is in charge.
   */
  const [windowSource, setWindowSource] = useState<SheetSource | null>(null);
  /** Present only when the windowed document is a workbook; drives the sheet picker. */
  const workbookRef = useRef<WorkbookSheetSource | null>(null);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [activeSheet, setActiveSheet] = useState(0);
  /** Bumped per document; the windowed view keys on it so a new file starts at the top. */
  const [windowLoad, setWindowLoad] = useState(0);
  const [saveAsVisible, setSaveAsVisible] = useState(false);
  const [saveAsFormat, setSaveAsFormat] = useState("xlsx");
  const [activeSpreadsheet, setActiveSpreadsheet] = useState<Spreadsheet | null>(null);
  const extRef = useRef("");
  const documentCacheIdRef = useRef("");
  const readOnlyRef = useRef(false);
  const spreadSheetRef = useRef<Spreadsheet | null>(null);
  const csvEncodingRef = useRef<"utf8" | "gbk">("utf8");
  const csvDelimiterRef = useRef(",");
  const initialFormattingRef = useRef("");
  /** True once the user answered "open anyway": the retry must not be gated again. */
  const forcedRef = useRef(false);
  /** The payload the guard refused, kept so the retry does not need another round trip. */
  const pendingPayloadRef = useRef<ExcelOpenPayload | null>(null);
  /** Wired inside the boot effect; the guard panel lives outside it. */
  const loadPayloadRef = useRef<((payload: ExcelOpenPayload) => void) | null>(null);

  useEffect(() => {
    findPanelRef.current = findPanel;
  }, [findPanel]);

  const adaptiveColorMode = colorMode === "adaptive";
  const themedDark = adaptiveColorMode && vscodeDark;

  useEffect(() => {
    if (!adaptiveColorMode) {
      return;
    }
    return observeVscodeThemeChange(() => {
      setVscodeDark(isVscodeEditorDark());
      requestAnimationFrame(() => spreadSheetRef.current?.reRender());
    });
  }, [adaptiveColorMode]);

  useEffect(() => {
    document.body.classList.toggle("office-adaptive", adaptiveColorMode);
    document.body.classList.toggle("office-dark", themedDark);
    return () => {
      document.body.classList.remove("office-adaptive");
      document.body.classList.remove("office-dark");
    };
  }, [adaptiveColorMode, themedDark]);

  const toggleColorMode = () => {
    setColorMode((prev) => {
      const next: ExcelColorMode = prev === "adaptive" ? "light" : "adaptive";
      saveExcelColorMode(next);
      if (next === "adaptive") {
        setVscodeDark(isVscodeEditorDark());
      }
      return next;
    });
  };

  useEffect(() => {
    spreadSheetRef.current?.reRender();
  }, [adaptiveColorMode, themedDark]);

  const handleAutoFitColumns = useCallback(() => {
    const spreadSheet = spreadSheetRef.current;
    if (!spreadSheet) return;
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

  /**
   * The user answered the size guard. A local file is fetched by this webview, so the retry
   * is immediate; a virtual document was never read by the host, so ask for it.
   */ const handleSelectSheet = useCallback((index: number) => {
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
    setLoading(true);
    if (payload.scheme === "file" || payload.bufferBase64 || payload.buffer?.length) {
      loadPayloadRef.current?.(payload);
      return;
    }
    handler.emit("openForce");
  }, []);

  const handleSave = useCallback(async () => {
    const spreadSheet = spreadSheetRef.current;
    if (!spreadSheet) return;
    if (readOnlyRef.current) {
      handleSaveAs();
      return;
    }

    const ext = extRef.current.replace(/^\./, "").toLowerCase();
    const sheets = spreadSheet.getData();
    const csvEncoding = csvEncodingRef.current;
    const csvDelimiter = csvDelimiterRef.current;

    if (
      ext !== "xlsx" &&
      ext !== "xlsm" &&
      hasFormattingChanged(initialFormattingRef.current, sheets)
    ) {
      await new Promise<void>((resolve) => {
        const dialog = modal.confirm({
          title: t("viewer.formatCannotPreserveTitle"),
          content: t("viewer.formatCannotPreserveContent", ext.toUpperCase()),
          okText: t("viewer.saveAsXlsx"),
          cancelText: t("button.cancel"),
          centered: true,
          getContainer: () => document.body,
          onOk: async () => {
            try {
              await export_xlsx(spreadSheet, "xlsx", csvEncoding, { saveAs: true }, csvDelimiter);
            } catch (error) {
              console.error(`Failed to save Excel file: ${(error as Error).message}`);
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
                      await export_xlsx(
                        spreadSheet,
                        extRef.current,
                        csvEncoding,
                        undefined,
                        csvDelimiter,
                      );
                    } catch (error) {
                      console.error(`Failed to save Excel file: ${(error as Error).message}`);
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
                      await export_xlsx(
                        spreadSheet,
                        "xlsx",
                        csvEncoding,
                        { saveAs: true },
                        csvDelimiter,
                      );
                    } catch (error) {
                      console.error(`Failed to save Excel file: ${(error as Error).message}`);
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
      await export_xlsx(spreadSheet, extRef.current, csvEncoding, undefined, csvDelimiter);
      spreadSheet.setSaveEnabled(false);
    } catch (error) {
      console.error(`Failed to save Excel file: ${(error as Error).message}`);
    }
  }, [modal, handleSaveAs]);

  const confirmSaveAs = useCallback(async (fmt: string) => {
    const spreadSheet = spreadSheetRef.current;
    if (!spreadSheet) return;
    setSaveAsVisible(false);
    try {
      await exportSaveAs(spreadSheet, fmt, csvEncodingRef.current, csvDelimiterRef.current);
      if (!readOnlyRef.current) {
        spreadSheet.setSaveEnabled(false);
      }
    } catch (error) {
      console.error(`Failed to save Excel file: ${(error as Error).message}`);
    }
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.code === "KeyS") {
        e.preventDefault();
        if (readOnlyRef.current) {
          handleSaveAs();
        } else {
          void handleSave();
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.code === "KeyF") {
        e.preventDefault();
        if (findPanelRef.current) {
          if (findPanelRef.current !== "find") {
            setFindPanel("find");
          }
          findReplacePanelRef.current?.focusFindInput(true);
        } else {
          setFindPanel("find");
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.code === "KeyH") {
        e.preventDefault();
        setFindPanel(readOnlyRef.current ? "find" : "replace");
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.altKey && e.code === "Digit0") {
        e.preventDefault();
        handleAutoFitColumns();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleAutoFitColumns, handleSave, handleSaveAs]);

  useEffect(() => {
    const container = document.getElementById("container");
    if (!container) return;

    const initSpreadsheet = async (buffer: ArrayBuffer, payload: any) => {
      const fileReadOnly = payload.readOnly === true;
      if (payload.ext?.match(/csv/i)) {
        csvEncodingRef.current = detectCsvEncoding(buffer);
      }
      const { sheets, maxLength, maxCols, csvDelimiter } = await loadSheets(buffer, payload.ext);
      if (csvDelimiter) {
        csvDelimiterRef.current = csvDelimiter;
      }
      const viewRowLen = Math.max(maxLength ?? 0, MIN_VIEW_ROWS);
      const viewColLen = Math.max(maxCols ?? 0, MIN_VIEW_COLS);
      container.innerHTML = "";
      const spreadSheet = new Spreadsheet(container, {
        mode: fileReadOnly ? "read" : "edit",
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
                handleAutoFitColumns();
              },
            },
          ],
        },
        showEditInVSCode: isCsvLikeExt(payload.ext ?? ""),
        row: { len: viewRowLen, height: 30 },
        col: { len: viewColLen },
        view: { height: () => window.innerHeight - 2 },
      });
      spreadSheetRef.current = spreadSheet;
      setActiveSpreadsheet(spreadSheet);
      setLoading(false);
      spreadSheet.loadData(sheets);

      if (!fileReadOnly) {
        spreadSheet.on("save", () => void handleSave());
      }
      spreadSheet.on("save-as", () => {
        handleSaveAs();
      });
      spreadSheet.on("edit-in-vscode", () => {
        handler.emit("editInVSCode", true);
      });
      spreadSheet.on("find", () => {
        if (findPanelRef.current) {
          if (findPanelRef.current !== "find") {
            setFindPanel("find");
          }
          findReplacePanelRef.current?.focusFindInput(true);
        } else {
          setFindPanel("find");
        }
      });
      const persistView = () => {
        saveViewState(documentCacheIdRef.current, spreadSheet.getSelection());
      };
      spreadSheet.on("cell-selected", () => {
        persistView();
      });
      spreadSheet.onSheetChange(() => {
        persistView();
      });
      spreadSheet.onOpenLink((linkPayload) => {
        const parsed = parseSpreadsheetLink(linkPayload.link);
        if (parsed.type === "internal") {
          spreadSheet.followHyperlink(linkPayload);
        } else {
          handler.emit("openExternal", parsed.url);
        }
      });
      spreadSheet.onProtectedCellDblClick(() => {
        message.info({
          duration: 2,
          content: t("viewer.protectedCell"),
          className: "excel-protected-cell-message",
        });
      });
      spreadSheet.onValidationError((errMessage) => {
        message.warning({
          duration: 2,
          content: errMessage,
          className: "excel-validation-error-message",
        });
      });
      spreadSheet.on("change", () => {
        if (!fileReadOnly) {
          spreadSheet.setSaveEnabled(true);
          handler.emit("change");
        }
      });
      const savedView = loadViewState(documentCacheIdRef.current);
      if (savedView) {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            restoreViewState(spreadSheet, savedView);
          });
        });
      }
      initialFormattingRef.current = buildFormattingSnapshot(spreadSheet.getData());
    };

    const loadPayload = (payload: ExcelOpenPayload) => {
      setWindowSource(null);
      loadOfficeBuffer(payload)
        .then(async (buffer) => {
          try {
            // A big text file is rendered by the windowed view: the grid would build one
            // object per cell and hold the whole sheet (ADR-0017).
            const view = sheetViewFor(payload.ext ?? "", payload.size, {
              virtual: payload.scheme !== "file",
            });
            if (view === "window") {
              if (/\.(xlsx|xlsm|xls|ods)$/i.test(payload.ext ?? "")) {
                // ExcelJS parses the whole workbook (a zip cannot be seeked), but into plain
                // row text instead of the grid's cell-object graph.
                // ExcelJS reads xlsx/xlsm; `.xls`/`.ods` have to go through SheetJS.
                const legacy = /\.(xls|ods)$/i.test(payload.ext ?? "");
                const rows = legacy
                  ? await loadLegacyWorkbookRows(buffer)
                  : await loadWorkbookRows(buffer);
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
              setLoading(false);
              return;
            }
            await initSpreadsheet(buffer, payload);
          } catch (e) {
            const msg = (e as Error).message || String(e);
            console.error(`Failed to load Excel file: ${msg}`, e);
            setLoadError(msg);
            setLoading(false);
          }
        })
        .catch((error) => {
          const msg = (error as Error).message || String(error);
          console.error(`Failed to load Excel file: ${msg}`, error);
          setLoadError(msg);
          setLoading(false);
        });
    };
    loadPayloadRef.current = loadPayload;

    handler
      .on("open", (payload: ExcelOpenPayload) => {
        const nextCacheId = payload.documentCacheId ?? "";
        if (nextCacheId !== documentCacheIdRef.current) {
          // A different document: "open anyway" does not carry over to it.
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
          // Refuse before fetching anything: on a remote workspace the download is already
          // half the cost, and the parse is what takes the renderer down.
          setTooLarge({
            size: payload.size ?? 0,
            name: payload.fileName ?? "",
            ext: payload.ext ?? "",
            limit: limitForView(payload.ext ?? "", { virtual: payload.scheme !== "file" }),
          });
          setLoadError(null);
          setLoading(false);
          return;
        }
        setTooLarge(null);
        loadPayload(payload);
      })
      .on("saveDone", () => {})
      .emit("init");

    let themeTimer: ReturnType<typeof setTimeout>;
    const themeObserver = new MutationObserver(() => {
      clearTimeout(themeTimer);
      themeTimer = setTimeout(() => spreadSheetRef.current?.reRender(), 120);
    });
    themeObserver.observe(document.head, { childList: true, subtree: true });

    return () => {
      spreadSheetRef.current = null;
      setActiveSpreadsheet(null);
      themeObserver.disconnect();
      clearTimeout(themeTimer);
    };
    // `handleAutoFitColumns` is deliberately omitted: this effect boots the spreadsheet
    // and calls emit('init'), so re-running it when that callback's identity changes would
    // re-initialise the whole sheet. It is stable enough that the stale closure is safe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message, handleSave, handleSaveAs]);

  return (
    <div className="excel-viewer">
      <Spin spinning={loading} fullscreen={true} />
      {loadError && !loading && (
        <div className="excel-load-error">
          <div className="excel-load-error-panel">
            <svg
              className="excel-load-error-icon"
              width="44"
              height="44"
              viewBox="0 0 44 44"
              fill="none"
              aria-hidden
            >
              <circle cx="22" cy="22" r="20" stroke="currentColor" strokeWidth="1.8" />
              <path d="M22 13v12" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
              <circle cx="22" cy="31" r="1.8" fill="currentColor" />
            </svg>
            <h2 className="excel-load-error-title">Failed to open file</h2>
            <span className="excel-load-error-message">{loadError}</span>
          </div>
        </div>
      )}
      {tooLarge && !loading && (
        <div className="excel-too-large">
          <div className="excel-too-large-panel">
            <svg
              className="excel-too-large-icon"
              width="44"
              height="44"
              viewBox="0 0 44 44"
              fill="none"
              aria-hidden
            >
              <circle cx="22" cy="22" r="20" stroke="currentColor" strokeWidth="1.8" />
              <path
                d="M15 27l6-12 6 12"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path d="M18.5 23h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            <h2 className="excel-too-large-title">{t("viewer.tooLargeTitle")}</h2>
            <p className="excel-too-large-body">
              {t(
                "viewer.tooLargeBody",
                tooLarge.name,
                formatBytes(tooLarge.size),
                formatBytes(tooLarge.limit),
              )}
            </p>
            <div className="excel-too-large-actions">
              <Button type="primary" onClick={handleOpenAnyway}>
                {t("viewer.tooLargeOpen")}
              </Button>
              {isCsvLikeExt(tooLarge.ext) && (
                <Button onClick={() => handler.emit("editInVSCode", true)}>
                  {t("viewer.tooLargeOpenInVSCode")}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
      {readOnly && !loading && !loadError && !tooLarge && !windowSource && (
        <div className="excel-readonly-banner">{t("viewer.readonlyBanner")}</div>
      )}
      {findPanel && !loading && !loadError && !tooLarge && (
        <FindReplacePanel
          ref={findReplacePanelRef}
          spreadSheet={activeSpreadsheet}
          mode={findPanel}
          onClose={() => setFindPanel(null)}
          readOnly={readOnly}
          onChanged={() => {
            if (!readOnlyRef.current) {
              spreadSheetRef.current?.setSaveEnabled(true);
            }
          }}
        />
      )}
      <Modal
        open={saveAsVisible}
        title={t("button.saveAs")}
        onCancel={() => setSaveAsVisible(false)}
        footer={[
          <Button
            key="cancel"
            onClick={() => setSaveAsVisible(false)}
            style={{ padding: "3px 12px", height: "auto" }}
          >
            {t("button.cancel")}
          </Button>,
          <Button
            key="ok"
            type="primary"
            onClick={() => void confirmSaveAs(saveAsFormat)}
            style={{ padding: "3px 12px", height: "auto" }}
          >
            {t("button.save")}
          </Button>,
        ]}
        getContainer={() => document.body}
        centered
        width={360}
      >
        <div style={{ padding: "8px 0 16px" }}>
          <div style={{ marginBottom: 12, opacity: 0.65, fontSize: 12 }}>
            {t("viewer.chooseExportFormat")}
          </div>
          <Radio.Group
            value={saveAsFormat}
            onChange={(e) => setSaveAsFormat(e.target.value as string)}
            style={{ display: "flex", flexDirection: "column", gap: 10 }}
          >
            {[
              {
                value: "xlsx",
                label: t("viewer.exportXlsxLabel"),
                desc: t("viewer.exportXlsxDesc"),
              },
              { value: "csv", label: t("viewer.exportCsvLabel"), desc: t("viewer.exportCsvDesc") },
              { value: "xls", label: t("viewer.exportXlsLabel"), desc: t("viewer.exportXlsDesc") },
              { value: "ods", label: t("viewer.exportOdsLabel"), desc: t("viewer.exportOdsDesc") },
            ].map((f) => (
              <Radio key={f.value} value={f.value} style={{ alignItems: "flex-start" }}>
                <span style={{ fontWeight: 500 }}>{f.label}</span>
                <span style={{ display: "block", fontSize: 11, opacity: 0.55, marginTop: 1 }}>
                  {f.desc}
                </span>
              </Radio>
            ))}
          </Radio.Group>
        </div>
      </Modal>
      <div id="container"></div>
      {windowSource && (
        <WindowedSheet
          key={windowLoad}
          source={windowSource}
          sheetNames={sheetNames}
          activeSheet={activeSheet}
          onSelectSheet={handleSelectSheet}
          fileName={pendingPayloadRef.current?.fileName ?? ""}
          onOpenInVSCode={() => handler.emit("editInVSCode", true)}
        />
      )}
      {!loading && !loadError && (
        <button
          type="button"
          className="dark-mode-toggle"
          title={adaptiveColorMode ? t("viewer.switchToLightMode") : t("viewer.switchToDarkMode")}
          onClick={toggleColorMode}
        >
          {adaptiveColorMode ? <SunOutlined /> : <MoonOutlined />}
        </button>
      )}
    </div>
  );
}

export default function Excel() {
  return (
    <App className="excel-app" message={{ top: 16 }}>
      <ExcelViewer />
    </App>
  );
}
