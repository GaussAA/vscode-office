import * as vscode from "vscode";
import { ReactApp } from "@/common/reactApp";
import { Handler } from "@/common/handler";
import { getExtensionResourceRoots } from "@/common/extensionResource";
import { buildDocumentCacheId } from "@/provider/handlers/officeContent";
import { JSON_MAX_ARRAY_BYTES } from "@/common/jsonPreviewTypes";
import { JsonPreviewSession } from "@/service/jsonPreview";

const panels = new Map<string, JsonPreviewPanel>();

function fileNameOf(uri: vscode.Uri): string {
  return uri.path.split("/").pop() || uri.fsPath;
}

function utf8Size(text: string): number {
  return new TextEncoder().encode(text).length;
}

interface JsonSource {
  text: string;
  byteSize: number;
  fromBuffer: boolean;
}

/**
 * Read the active buffer when the file is open, otherwise the bytes on disk. The buffer wins
 * because the preview is explicitly opened from an editor and should show what that editor
 * shows; `fromBuffer` tells the UI only when those bytes are actually unsaved.
 */
async function readSource(uri: vscode.Uri): Promise<JsonSource> {
  const open = vscode.workspace.textDocuments.find(
    (document) => document.uri.toString() === uri.toString(),
  );
  if (open) {
    const text = open.getText();
    return { text, byteSize: utf8Size(text), fromBuffer: open.isDirty };
  }

  const stat = await vscode.workspace.fs.stat(uri);
  // A file above this cap can only be too-large; do not read 500 MB to say so.
  if (stat.size > JSON_MAX_ARRAY_BYTES) {
    return { text: "", byteSize: stat.size, fromBuffer: false };
  }
  const bytes = await vscode.workspace.fs.readFile(uri);
  return {
    text: new TextDecoder().decode(bytes),
    byteSize: bytes.byteLength,
    fromBuffer: false,
  };
}

/**
 * One command-opened read-only JSON panel. It is not a custom editor: no file selector, no
 * restart default, no editing path. The host owns the text and the top-level array index;
 * the webview asks for record windows and one record at a time.
 */
class JsonPreviewPanel {
  private session: JsonPreviewSession;
  private readonly handler: Handler;

  static async open(context: vscode.ExtensionContext, uri: vscode.Uri) {
    const key = uri.toString();
    const existing = panels.get(key);
    if (existing) {
      existing.panel.reveal();
      await existing.refresh();
      return;
    }

    const source = await readSource(uri);
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
    this.session = new JsonPreviewSession(
      source.text,
      source.byteSize,
      fileNameOf(uri),
      buildDocumentCacheId(uri),
      source.fromBuffer,
    );

    const handler = Handler.bind(panel, uri);
    this.handler = handler;
    panel.onDidDispose(() => {
      this.session.dispose();
      panels.delete(uri.toString());
    });

    handler
      .on("init", () => this.emitInfo())
      .on("jsonRecords", (request?: { requestId?: number; start?: number; end?: number }) => {
        if (
          typeof request?.requestId !== "number" ||
          typeof request.start !== "number" ||
          typeof request.end !== "number"
        ) {
          return;
        }
        handler.emit("jsonRecordsData", {
          requestId: request.requestId,
          records: this.session.recordsInWindow(request.start, request.end),
        });
      })
      .on("jsonRecord", (request?: { requestId?: number; index?: number }) => {
        if (typeof request?.requestId !== "number" || typeof request.index !== "number") return;
        handler.emit("jsonRecordData", {
          requestId: request.requestId,
          index: request.index,
          entry: this.session.record(request.index),
        });
      })
      .on("jsonSearch", (request?: { requestId?: number; query?: string }) => {
        if (typeof request?.requestId !== "number" || typeof request.query !== "string") return;
        this.session.search(request.requestId, request.query, {
          onBatch: (batch) => handler.emit("jsonSearchBatch", batch),
        });
      })
      .on("jsonSearchCancel", () => this.session.cancelSearch())
      .on("jsonReload", () => {
        void this.refresh();
      })
      .on("fileChange", () => {
        void this.refresh();
      })
      .on("jsonOpenText", () => {
        void vscode.window.showTextDocument(this.uri, {
          preview: false,
          viewColumn: vscode.ViewColumn.Beside,
        });
      });

    void ReactApp.view(panel.webview, { route: "json" });
  }

  private emitInfo() {
    this.handler.emit("jsonInfo", this.session.info);
    const root = this.session.rootEntry;
    if (root) this.handler.emit("jsonRoot", { entry: root });
  }

  async refresh() {
    try {
      const source = await readSource(this.uri);
      this.session.dispose();
      this.session = new JsonPreviewSession(
        source.text,
        source.byteSize,
        fileNameOf(this.uri),
        buildDocumentCacheId(this.uri),
        source.fromBuffer,
      );
      this.emitInfo();
    } catch (error) {
      void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
    }
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
