import type { CustomEditorOptions } from "@/common/customEditorOptions";
import { ReactApp } from "@/common/reactApp";
import { getFileSuffix } from "@/common/fileSuffix";
import * as vscode from "vscode";
import { Handler } from "../common/handler";
import { getExtensionResourceRoots } from "@/common/extensionResource";
import { handleCommonEvent } from "./commonHandler";
import { openDocumentSource } from "./documentSource";
import { createParquetHandlers } from "./parquetHandlers";
import { createSaveTracker } from "./saveHandlers";
import { buildDocumentCacheId } from "./handlers/officeContent";
import { parquetScanCache } from "../service/parquetScanCache";
import { registerDataViewerCacheClearer } from "../service/dataViewerCacheClear";
import { ExcelWorkbookCache } from "../service/excelWorkbookCache";
import { CsvIndexCache } from "../service/csvIndexCache";
import { createExcelWorkbookHost } from "./excelWorkbookHost";
import { createExcelCsvHost } from "./excelCsvHost";
import path from "node:path";

const EXCEL_WORKBOOK_SUFFIXES = new Set([".xlsx", ".xlsm", ".xls", ".ods"]);
const EXCEL_CSV_SUFFIXES = new Set([".csv", ".tsv"]);

function isWorkbookUri(uri: vscode.Uri): boolean {
  return EXCEL_WORKBOOK_SUFFIXES.has(getFileSuffix(uri.fsPath));
}

function isCsvUri(uri: vscode.Uri): boolean {
  return EXCEL_CSV_SUFFIXES.has(getFileSuffix(uri.fsPath));
}

/**
 * Spreadsheet and parquet viewers.
 *
 * Word, PowerPoint, PDF, ePub, fonts, images, PSD, ICNS, XMind, HTML and archives were removed
 * in 6.0.0 (ADR-0015): the extension only keeps the three formats its maintainer actually opens,
 * and everything else is either covered by VS Code or by a better dedicated reader.
 */
export class OfficeViewerProvider implements vscode.CustomReadonlyEditorProvider {
  /** Shared by every panel: "save as" stamps another file's change event, not just our own. */
  private readonly saves = createSaveTracker();
  /** Open parquet panels, for the Clear cache broadcast. */
  private readonly parquetHandlers = new Set<Handler>();
  /** Open spreadsheet panels, for the Clear cache broadcast. */
  private readonly excelPanels = new Set<Handler>();
  /** Set by Clear cache when it ran with no parquet panel to clear; consumed by the next open. */
  private parquetClearPending = false;
  /** Set by Clear cache when it ran with no spreadsheet panel to clear. */
  private excelClearPending = false;
  /** Parsed windowed workbook rows, shared by every Excel tab in this session (ADR-0027). */
  private readonly excelWorkbooks = new ExcelWorkbookCache();
  /** Scanned CSV record indexes, shared by every Excel tab (ADR-0028). */
  private readonly excelCsvIndexes: CsvIndexCache;

  constructor(private context: vscode.ExtensionContext) {
    this.excelCsvIndexes = new CsvIndexCache(
      path.join(context.globalStorageUri.fsPath, "csv-index"),
    );
    registerDataViewerCacheClearer(() => this.clearDataViewerCaches());
  }

  /**
   * Clear the host scan cache and every open parquet/spreadsheet view. When none is open the
   * webview caches cannot be reached from the host, so the next open carries a one-shot flag.
   */
  public async clearDataViewerCaches(): Promise<void> {
    parquetScanCache.clear();
    this.excelWorkbooks.clear();
    await this.excelCsvIndexes.clear().catch(() => undefined);
    const parquetActive = [...this.parquetHandlers].filter((handler) => !handler.disposed);
    for (const handler of parquetActive) handler.emit("clearParquetCache");
    if (parquetActive.length === 0) this.parquetClearPending = true;

    const excelActive = [...this.excelPanels].filter((handler) => !handler.disposed);
    for (const handler of excelActive) handler.emit("clearExcelCache");
    if (excelActive.length === 0) this.excelClearPending = true;
  }

  private consumeParquetClear(): boolean {
    if (!this.parquetClearPending) return false;
    this.parquetClearPending = false;
    return true;
  }

  private consumeExcelClear(): boolean {
    if (!this.excelClearPending) return false;
    this.excelClearPending = false;
    return true;
  }

  bindCustomEditors(viewOption: CustomEditorOptions) {
    return [
      vscode.window.registerCustomEditorProvider("GaussAA.officeViewer", this, viewOption),
      vscode.window.registerCustomEditorProvider("GaussAA.parquetViewer", this, viewOption),
    ];
  }

  public openCustomDocument(
    uri: vscode.Uri,
    openContext: vscode.CustomDocumentOpenContext,
    token: vscode.CancellationToken,
  ): vscode.CustomDocument | Thenable<vscode.CustomDocument> {
    return { uri, dispose: (): void => {} };
  }

  public resolveCustomEditor(
    document: vscode.CustomDocument,
    webviewPanel: vscode.WebviewPanel,
    token: vscode.CancellationToken,
  ): void | Thenable<void> {
    const uri = document.uri;
    const webview = webviewPanel.webview;
    const folderPath = vscode.Uri.joinPath(uri, "..");
    webview.options = {
      enableScripts: true,
      localResourceRoots: [...getExtensionResourceRoots(this.context), folderPath],
    };

    let route: "excel" | "parquet";
    switch (getFileSuffix(uri.fsPath)) {
      case ".xlsx":
      case ".xlsm":
      case ".xls":
      case ".csv":
      case ".tsv":
      case ".ods":
        route = "excel";
        break;
      case ".parquet":
        route = "parquet";
        break;
      default:
        void vscode.commands.executeCommand("vscode.openWith", uri, "default");
        return;
    }

    const handler = Handler.bind(webviewPanel, uri);
    // The flag is per viewer; another viewer must not clear this one's state just because a
    // command ran earlier.
    const clearCache =
      route === "parquet"
        ? this.consumeParquetClear()
        : route === "excel"
          ? this.consumeExcelClear()
          : false;
    handleCommonEvent(uri, handler, this.saves, {
      clearCache,
      hostWorkbook: route === "excel" && isWorkbookUri(uri),
      hostCsv: route === "excel" && isCsvUri(uri),
    });

    if (route === "parquet") {
      // The parquet messages the host answers: the profile comes from row-group metadata and
      // never reads a data page; the two scans decode a bounded prefix and are cached in the
      // host by document + stat fingerprint (ADR-0025).
      const parquet = createParquetHandlers({
        openSource: () => openDocumentSource(uri),
        emit: (type, payload) => handler.emit(type, payload),
        fingerprint: async () => {
          try {
            const stat = await vscode.workspace.fs.stat(uri);
            return { key: buildDocumentCacheId(uri), size: stat.size, mtimeMs: stat.mtime };
          } catch {
            // A virtual or unsupported scheme cannot validate bytes; scan, but do not cache.
            return null;
          }
        },
      });
      this.parquetHandlers.add(handler);
      handler
        .on("parquetProfile", (request) => parquet.profile(request))
        .on("parquetColumnScan", (request) => parquet.columnScan(request))
        .on("parquetEmptyShareScan", (request) => parquet.emptyShareScan(request));
      // A batch scan can run for seconds on a wide nested schema; closing the tab aborts it
      // instead of letting the host decode to the row cap for nobody.
      webviewPanel.onDidDispose(() => {
        this.parquetHandlers.delete(handler);
        parquet.dispose();
      });
    }

    if (route === "excel") {
      const stat = async () => {
        try {
          const value = await vscode.workspace.fs.stat(uri);
          return { size: value.size, mtimeMs: value.mtime };
        } catch {
          return null;
        }
      };
      const workbook = createExcelWorkbookHost({
        documentCacheId: buildDocumentCacheId(uri),
        cache: this.excelWorkbooks,
        stat,
        emit: (type, payload) => handler.emit(type, payload),
      });
      const csv = createExcelCsvHost({
        documentCacheId: buildDocumentCacheId(uri),
        cache: this.excelCsvIndexes,
        stat,
        emit: (type, payload) => handler.emit(type, payload),
      });
      handler
        .on("excelWorkbookOpen", (request) => workbook.open(request))
        .on("excelWorkbookRows", (request) => workbook.rows(request))
        .on("excelWorkbookStore", (request) => workbook.store(request))
        .on("excelCsvIndexOpen", (request) => csv.open(request))
        .on("excelCsvIndexStore", (request) => csv.store(request));
      this.excelPanels.add(handler);
      webviewPanel.onDidDispose(() => this.excelPanels.delete(handler));
    }

    return ReactApp.view(webview, { route });
  }
}
