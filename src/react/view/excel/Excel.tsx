import { MoonOutlined, SunOutlined } from "@ant-design/icons";
import { App, Spin } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import { handler } from "../../util/vscode.ts";
import { isVscodeEditorDark, observeVscodeThemeChange } from "../../util/vscodeTheme.ts";
import "./Excel.less";
import FindReplacePanel, { type FindReplacePanelHandle } from "./FindReplacePanel";
import { initExcelLocale, t } from "./excel_i18n";
import WindowedSheet from "./WindowedSheet";
import ExcelGuard from "./ExcelGuard";
import ExcelLoadError from "./ExcelLoadError";
import ExcelSaveAsDialog from "./ExcelSaveAsDialog";
import { useExcelDocumentSession } from "./useExcelDocumentSession";
import { loadExcelColorMode, saveExcelColorMode, type ExcelColorMode } from "./excelViewState";
import { ErrorBoundary } from "../../components/ErrorBoundary.tsx";

initExcelLocale();

function ExcelViewer() {
  const { message, modal } = App.useApp();
  const [colorMode, setColorMode] = useState(loadExcelColorMode);
  const [vscodeDark, setVscodeDark] = useState(isVscodeEditorDark);
  const [findPanel, setFindPanel] = useState<"find" | "replace" | null>(null);
  const findPanelRef = useRef<"find" | "replace" | null>(null);
  const findReplacePanelRef = useRef<FindReplacePanelHandle>(null);
  /** Ctrl+F in the windowed view focuses this input, not the dead grid Find panel. */
  const windowedFindInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    findPanelRef.current = findPanel;
  }, [findPanel]);

  const focusFindPanel = useCallback(() => {
    if (findPanelRef.current) {
      if (findPanelRef.current !== "find") {
        setFindPanel("find");
      }
      findReplacePanelRef.current?.focusFindInput(true);
    } else {
      setFindPanel("find");
    }
  }, []);

  const resetFindPanel = useCallback(() => {
    setFindPanel(null);
  }, []);

  const {
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
    fileName,
  } = useExcelDocumentSession({
    message,
    modal,
    onFind: focusFindPanel,
    onResetFind: resetFindPanel,
  });

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
  }, [adaptiveColorMode, spreadSheetRef]);

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
  }, [adaptiveColorMode, spreadSheetRef, themedDark]);

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
        if (windowSource) {
          windowedFindInputRef.current?.focus();
          windowedFindInputRef.current?.select();
          return;
        }
        focusFindPanel();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.code === "KeyH") {
        e.preventDefault();
        if (windowSource) {
          windowedFindInputRef.current?.focus();
          return;
        }
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
  }, [focusFindPanel, handleAutoFitColumns, handleSave, handleSaveAs, readOnlyRef, windowSource]);

  return (
    <div className="excel-viewer">
      <Spin spinning={loading} fullscreen={true} />
      {loadError && !loading && <ExcelLoadError message={loadError} />}
      {tooLarge && !loading && (
        <ExcelGuard
          key={`${tooLarge.name}-${tooLarge.size}`}
          file={tooLarge}
          onOpenAnyway={handleOpenAnyway}
          onOpenInVSCode={() => handler.emit("editInVSCode", true)}
        />
      )}
      {readOnly && !loading && !loadError && !tooLarge && !windowSource && (
        <div className="excel-readonly-banner">{t("viewer.readonlyBanner")}</div>
      )}
      {findPanel && !loading && !loadError && !tooLarge && !windowSource && (
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
      <ExcelSaveAsDialog
        open={saveAsVisible}
        onCancel={() => setSaveAsVisible(false)}
        onSave={(format) => {
          setSaveAsVisible(false);
          void confirmSaveAs(format);
        }}
      />
      <div id="container"></div>
      {windowSource && (
        <WindowedSheet
          key={windowLoad}
          source={windowSource}
          sheetNames={sheetNames}
          activeSheet={activeSheet}
          onSelectSheet={handleSelectSheet}
          fileName={fileName}
          onOpenInVSCode={() => handler.emit("editInVSCode", true)}
          findInputRef={windowedFindInputRef}
        />
      )}
      {!loading && !loadError && !windowSource && !tooLarge && (
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
    <ErrorBoundary>
      <App className="excel-app" message={{ top: 16 }}>
        <ExcelViewer />
      </App>
    </ErrorBoundary>
  );
}
