import * as vscode from "vscode";
import path from "node:path";
import { ReactApp } from "@/common/reactApp";
import { Handler } from "@/common/handler";
import { getExtensionResourceRoots } from "@/common/extensionResource";
import { registerDataViewerCacheClearer } from "@/service/dataViewerCacheClear";
import { JsonPreviewRangeCache } from "@/service/jsonPreviewRangeCache";
import { buildDocumentCacheId } from "@/provider/handlers/officeContent";
import {
  createJsonPreviewHandlers,
  readJsonSource,
  type JsonSource,
  type JsonSourceFingerprint,
  type JsonSourceReader,
} from "./jsonPreviewHandlers";

const panels = new Map<string, JsonPreviewPanel>();

/** Created in `activateJsonPreview`; the command never runs before activation. */
let rangeCache: JsonPreviewRangeCache | null = null;
/** Set by the unified Clear command when it ran with no JSON panel to message. */
let clearPending = false;

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
 * Read the text and, for a disk source, attach the cached top-level ranges. The cache is only
 * a shortcut for `indexJsonArray`; the text path (buffer/file) is unchanged.
 */
async function readWithCache(uri: vscode.Uri, reader: JsonSourceReader): Promise<JsonSource> {
  const source = await readJsonSource(reader);
  if (source.fromBuffer || !rangeCache) return source;
  try {
    const stat = await reader.stat();
    if (typeof stat.mtime !== "number") return source;
    const fingerprint: JsonSourceFingerprint = {
      key: buildDocumentCacheId(uri),
      size: stat.size,
      mtimeMs: stat.mtime,
    };
    const records = await rangeCache.get(fingerprint);
    return { ...source, records, fingerprint };
  } catch {
    return source;
  }
}

function consumeClear(): boolean {
  if (!clearPending) return false;
  clearPending = false;
  return true;
}

/** Called by the unified Clear command; open panels reload after the cache is gone. */
export async function clearJsonPreviewCaches(): Promise<void> {
  await rangeCache?.clear().catch(() => undefined);
  const active = [...panels.values()];
  for (const panel of active) panel.clearCaches();
  if (active.length === 0) clearPending = true;
}

/**
 * One command-opened read-only JSON panel. It is not a custom editor: no file selector, no
 * restart default, no editing path. The host owns the text and the top-level array index;
 * the webview asks for record windows and one record at a time. Which bytes it shows and how
 * a request is answered are in `jsonPreviewHandlers`; this class is the wiring.
 */
class JsonPreviewPanel {
  private readonly handlers: ReturnType<typeof createJsonPreviewHandlers>;
  private readonly handler: Handler;

  static async open(context: vscode.ExtensionContext, uri: vscode.Uri) {
    const key = uri.toString();
    const existing = panels.get(key);
    if (existing) {
      existing.panel.reveal();
      await existing.handlers.reload();
      return;
    }

    const reader = readerFor(uri);
    const source = await readWithCache(uri, reader);
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
    const instance = new JsonPreviewPanel(panel, uri, source, reader);
    panels.set(key, instance);
  }

  private constructor(
    readonly panel: vscode.WebviewPanel,
    private readonly uri: vscode.Uri,
    source: JsonSource,
    reader: JsonSourceReader,
  ) {
    const handler = Handler.bind(panel, uri);
    this.handler = handler;
    const handlers = createJsonPreviewHandlers(
      {
        fileName: fileNameOf(uri),
        cacheId: buildDocumentCacheId(uri),
        read: () => readWithCache(uri, reader),
        emit: (type, payload) => handler.emit(type, payload),
        reportError: (message) => void vscode.window.showErrorMessage(message),
        storeRanges: (fingerprint, ranges) => {
          void rangeCache?.set(fingerprint, ranges);
        },
      },
      source,
    );
    this.handlers = handlers;
    panel.onDidDispose(() => {
      handlers.dispose();
      panels.delete(uri.toString());
    });

    handler
      .on("init", () => {
        if (consumeClear()) handler.emit("clearJsonPreviewCache");
        handlers.init();
      })
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

  clearCaches(): void {
    this.handler.emit("clearJsonPreviewCache");
  }
}

/** Register the command; package.json contributes the three entry points, not a custom editor. */
export function activateJsonPreview(context: vscode.ExtensionContext): void {
  rangeCache = new JsonPreviewRangeCache(
    path.join(context.globalStorageUri.fsPath, "json-preview-index"),
  );
  context.subscriptions.push(registerDataViewerCacheClearer(() => clearJsonPreviewCaches()));
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
