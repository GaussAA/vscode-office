import * as vscode from "vscode";
import { ReactApp } from "@/common/reactApp";
import { Handler } from "@/common/handler";
import { getExtensionResourceRoots } from "@/common/extensionResource";
import { buildDocumentCacheId } from "@/provider/handlers/officeContent";
import {
  createJsonPreviewHandlers,
  readJsonSource,
  type JsonSource,
  type JsonSourceReader,
} from "./jsonPreviewHandlers";

const panels = new Map<string, JsonPreviewPanel>();

function fileNameOf(uri: vscode.Uri): string {
  return uri.path.split("/").pop() || uri.fsPath;
}

/** The three ways to reach the document, backed by the workspace. The rule is in the handlers. */
function readerFor(uri: vscode.Uri): JsonSourceReader {
  return {
    openBuffer: () => {
      const open = vscode.workspace.textDocuments.find(
        (document) => document.uri.toString() === uri.toString(),
      );
      return open ? { text: open.getText(), isDirty: open.isDirty } : undefined;
    },
    stat: () => vscode.workspace.fs.stat(uri),
    readFile: () => vscode.workspace.fs.readFile(uri),
  };
}

/**
 * One command-opened read-only JSON panel. It is not a custom editor: no file selector, no
 * restart default, no editing path. The host owns the text and the top-level array index;
 * the webview asks for record windows and one record at a time. Which bytes it shows and how
 * a request is answered are in `jsonPreviewHandlers`; this class is the wiring.
 */
class JsonPreviewPanel {
  private readonly handlers: ReturnType<typeof createJsonPreviewHandlers>;

  static async open(context: vscode.ExtensionContext, uri: vscode.Uri) {
    const key = uri.toString();
    const existing = panels.get(key);
    if (existing) {
      existing.panel.reveal();
      await existing.handlers.reload();
      return;
    }

    const source = await readJsonSource(readerFor(uri));
    const panel = vscode.window.createWebviewPanel(
      "GaussAA.jsonPreview",
      fileNameOf(uri),
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        localResourceRoots: [...getExtensionResourceRoots(context)],
        retainContextWhenHidden: true,
      },
    );
    const instance = new JsonPreviewPanel(panel, uri, source);
    panels.set(key, instance);
  }

  private constructor(
    readonly panel: vscode.WebviewPanel,
    private readonly uri: vscode.Uri,
    source: JsonSource,
  ) {
    const handler = Handler.bind(panel, uri);
    const reader = readerFor(uri);
    const handlers = createJsonPreviewHandlers(
      {
        fileName: fileNameOf(uri),
        cacheId: buildDocumentCacheId(uri),
        read: () => readJsonSource(reader),
        emit: (type, payload) => handler.emit(type, payload),
        reportError: (message) => void vscode.window.showErrorMessage(message),
      },
      source,
    );
    this.handlers = handlers;
    panel.onDidDispose(() => {
      handlers.dispose();
      panels.delete(uri.toString());
    });

    handler
      .on("init", () => handlers.init())
      .on("jsonRecords", (request) => handlers.records(request))
      .on("jsonRecord", (request) => handlers.record(request))
      .on("jsonSearch", (request) => handlers.search(request))
      .on("jsonSearchCancel", () => handlers.cancelSearch())
      .on("jsonReload", () => {
        void handlers.reload();
      })
      .on("fileChange", () => {
        void handlers.reload();
      })
      .on("jsonOpenText", () => {
        void vscode.window.showTextDocument(this.uri, {
          preview: false,
          viewColumn: vscode.ViewColumn.Beside,
        });
      });

    void ReactApp.view(panel.webview, { route: "json" });
  }
}
/** Register the command; package.json contributes the three entry points, not a custom editor. */
export function activateJsonPreview(context: vscode.ExtensionContext): void {
  const command = vscode.commands.registerCommand(
    "GaussAA.office.previewJson",
    async (resource?: vscode.Uri) => {
      try {
        let target = resource instanceof vscode.Uri ? resource : undefined;
        if (!target) {
          const active = vscode.window.activeTextEditor;
          if (active && active.document.uri.path.toLowerCase().endsWith(".json")) {
            target = active.document.uri;
          }
        }
        if (!target) {
          const picked = await vscode.window.showOpenDialog({
            canSelectMany: false,
            openLabel: "Preview JSON",
            filters: { JSON: ["json"] },
          });
          target = picked?.[0];
        }
        if (target) await JsonPreviewPanel.open(context, target);
      } catch (error) {
        void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
      }
    },
  );
  context.subscriptions.push(command);
}
