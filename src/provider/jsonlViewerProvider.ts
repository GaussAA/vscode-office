import type { CustomEditorOptions } from "@/common/customEditorOptions";
import * as vscode from "vscode";
import { Handler } from "@/common/handler";
import { ReactApp } from "@/common/reactApp";
import { getExtensionResourceRoots } from "@/common/extensionResource";
import { buildDocumentCacheId } from "@/provider/handlers/officeContent";
import { JsonlFile } from "@/service/jsonlFile";
import { JsonlSession } from "@/service/jsonlSession";
import { openDocumentSource } from "./documentSource";
import { createJsonlHandlers } from "./jsonlHandlers";
import { createProgressReporter } from "@/common/jsonlIndexProgress";
import type { ByteSource } from "@/common/byteSource";

class JsonlDocument implements vscode.CustomDocument {
  public session: JsonlSession | null = null;
  public pendingSource: ByteSource | null = null;

  constructor(public readonly uri: vscode.Uri) {}

  dispose(): void {
    this.session?.dispose();
    void this.pendingSource?.close?.();
  }
}

/**
 * JSONL viewer: one line is one self-describing JSON document, so the preview
 * surface is a two-pane layout — a directory of entries on the left, the full
 * tree of the selected entry on the right. Never a table: heterogeneous keys
 * would force a schema that does not exist.
 */
export class JsonlViewerProvider implements vscode.CustomReadonlyEditorProvider<JsonlDocument> {
  constructor(private context: vscode.ExtensionContext) {}

  bindCustomEditor(viewOption: CustomEditorOptions) {
    return vscode.window.registerCustomEditorProvider("GaussAA.jsonlViewer", this, viewOption);
  }

  async openCustomDocument(uri: vscode.Uri): Promise<JsonlDocument> {
    const document = new JsonlDocument(uri);
    // Fast-fail: open source now so file-not-found/permission errors surface early.
    // But don't await indexing — that happens later in init handler.
    document.pendingSource = await openDocumentSource(uri);
    return document;
  }

  async resolveCustomEditor(
    document: JsonlDocument,
    webviewPanel: vscode.WebviewPanel,
  ): Promise<void> {
    const webview = webviewPanel.webview;
    const folderPath = vscode.Uri.joinPath(document.uri, "..");
    webview.options = {
      enableScripts: true,
      localResourceRoots: [...getExtensionResourceRoots(this.context), folderPath],
    };

    const handler = Handler.bind(webviewPanel, document.uri);
    const current = () => document.session;

    const handlers = createJsonlHandlers({
      session: current,
      reopen: async (opts) => {
        const source = document.pendingSource ?? (await openDocumentSource(document.uri));
        document.pendingSource = null;

        const reporter = opts?.onProgress
          ? createProgressReporter({
              onProgress: (progress) => opts.onProgress!(progress.loaded, progress.total),
              showAfterMs: 300,
              minIntervalMs: 100,
            })
          : null;

        try {
          const file = await JsonlFile.open(source, {
            onProgress: reporter ? (loaded, total) => reporter.report(loaded, total) : undefined,
            cancel: opts?.cancel,
          });
          reporter?.stop();
          const previous = document.session;
          document.session = new JsonlSession(file);
          previous?.dispose();
        } catch (err) {
          reporter?.stop();
          await source.close?.();
          throw err;
        }
      },
      emit: (type, payload) => handler.emit(type, payload),
      info: () => ({
        fileName: document.uri.path.split("/").pop() ?? document.uri.fsPath,
        cacheId: buildDocumentCacheId(document.uri),
        lineCount: current()?.lineCount ?? 0,
        byteSize: current()?.byteSize ?? 0,
      }),
    });

    handler
      .on("init", (request) => handlers.init(request))
      .on("jsonlReload", (request) => handlers.reload(request))
      .on("fileChange", () => handlers.reload())
      .on("jsonlIndex", (request) => handlers.index(request))
      .on("jsonlEntry", (request) => handlers.entry(request))
      .on("jsonlSearch", (request) => handlers.search(request))
      .on("jsonlSearchCancel", (request) => handlers.cancelSearch(request));

    await ReactApp.view(webview, { route: "jsonl" });
  }
}
