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

  constructor(private context: vscode.ExtensionContext) {}

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

    const handler = Handler.bind(webviewPanel, uri);
    handleCommonEvent(uri, handler, this.saves);

    let route: string;
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

    if (route === "parquet") {
      // The one message the host answers for parquet today: the profile is read from row-group
      // metadata, so it never pulls a data page through `openByteSource`.
      const parquet = createParquetHandlers({
        openSource: () => openDocumentSource(uri),
        emit: (type, payload) => handler.emit(type, payload),
      });
      handler
        .on("parquetProfile", (request) => parquet.profile(request))
        .on("parquetColumnScan", (request) => parquet.columnScan(request))
        .on("parquetEmptyShareScan", (request) => parquet.emptyShareScan(request));
      // A batch scan can run for seconds on a wide nested schema; closing the tab aborts it
      // instead of letting the host decode to the row cap for nobody.
      webviewPanel.onDidDispose(() => parquet.dispose());
    }

    return ReactApp.view(webview, { route });
  }
}
