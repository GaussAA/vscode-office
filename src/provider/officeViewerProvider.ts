import type { CustomEditorOptions } from "@/common/customEditorOptions";
import { ReactApp } from "@/common/reactApp";
import * as vscode from "vscode";
import { extname } from "node:path";
import { Handler } from "../common/handler";
import { getExtensionResourceRoots } from "@/common/extensionResource";
import { handleCommonEvent } from "./commonHandler";
import { openDocumentSource } from "./documentSource";
import { createParquetHandlers } from "./parquetHandlers";
import { buildDocumentCacheId } from "./handlers/officeContent";
import { parquetScanCache } from "../service/parquetScanCache";
import { registerDataViewerCacheClearer } from "../service/dataViewerCacheClear";

/**
 * Parquet viewer.
 *
 * Word, PowerPoint, PDF, ePub, fonts, images, PSD, ICNS, XMind, HTML and archives were removed
 * in 6.0.0 (ADR-0015), and the spreadsheet viewer in 7.0.0 (ADR-0029). What is left is the one
 * format whose reading path this provider owns; JSONL has its own provider and JSON is a
 * command-opened inspector, not a viewer.
 */
export class OfficeViewerProvider implements vscode.CustomReadonlyEditorProvider {
  /** Open parquet panels, for the Clear cache broadcast. */
  private readonly parquetHandlers = new Set<Handler>();
  /** Set by Clear cache when it ran with no parquet panel to clear; consumed by the next open. */
  private parquetClearPending = false;

  constructor(private context: vscode.ExtensionContext) {
    registerDataViewerCacheClearer(() => this.clearDataViewerCaches());
  }

  /**
   * Clear the host scan cache and every open parquet view. When none is open the webview caches
   * cannot be reached from the host, so the next open carries a one-shot flag.
   */
  public async clearDataViewerCaches(): Promise<void> {
    parquetScanCache.clear();
    const parquetActive = [...this.parquetHandlers].filter((handler) => !handler.disposed);
    for (const handler of parquetActive) handler.emit("clearParquetCache");
    if (parquetActive.length === 0) this.parquetClearPending = true;
  }

  private consumeParquetClear(): boolean {
    if (!this.parquetClearPending) return false;
    this.parquetClearPending = false;
    return true;
  }

  bindCustomEditors(viewOption: CustomEditorOptions) {
    return [vscode.window.registerCustomEditorProvider("GaussAA.parquetViewer", this, viewOption)];
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
    if (extname(uri.fsPath).toLowerCase() !== ".parquet") {
      void vscode.commands.executeCommand("vscode.openWith", uri, "default");
      return;
    }
    const folderPath = vscode.Uri.joinPath(uri, "..");
    webview.options = {
      enableScripts: true,
      localResourceRoots: [...getExtensionResourceRoots(this.context), folderPath],
    };

    const handler = Handler.bind(webviewPanel, uri);
    handleCommonEvent(uri, handler, { clearCache: this.consumeParquetClear() });

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

    return ReactApp.view(webview, { route: "parquet" });
  }
}
