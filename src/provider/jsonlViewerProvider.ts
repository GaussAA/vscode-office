import type { FileFingerprint } from "@/common/fileFingerprint";
import type { CustomEditorOptions } from "@/common/customEditorOptions";
import * as vscode from "vscode";
import path from "node:path";
import { Handler } from "@/common/handler";
import { ReactApp } from "@/common/reactApp";
import { getExtensionResourceRoots } from "@/common/extensionResource";
import { buildDocumentCacheId } from "@/provider/handlers/officeContent";
import { JsonlFile } from "@/service/jsonlFile";
import { JsonlIndexCache } from "@/service/jsonlIndexCache";
import { JsonlSession } from "@/service/jsonlSession";
import { registerDataViewerCacheClearer } from "@/service/dataViewerCacheClear";
import { openDocumentSource } from "./documentSource";
import { createJsonlHandlers } from "./jsonlHandlers";

class JsonlDocument implements vscode.CustomDocument {
  /** Source opened but not yet indexed; consumed by the first openSession call. */
  public pendingSource: ReturnType<typeof openDocumentSource> | null = null;
  /** Signals to the indexing task that the document was closed. */
  public cancelToken = { cancelled: false };
  public session: JsonlSession | null = null;

  constructor(public readonly uri: vscode.Uri) {}

  dispose(): void {
    this.cancelToken.cancelled = true;
    if (this.pendingSource) {
      void this.pendingSource.then((source) => source.close?.());
      this.pendingSource = null;
    }
    this.session?.dispose();
  }
}

/**
 * JSONL viewer: one line is one self-describing JSON document, so the preview
 * surface is a two-pane layout — a directory of entries on the left, the full
 * tree of the selected entry on the right. Never a table: heterogeneous keys
 * would force a schema that does not exist.
 */
export class JsonlViewerProvider implements vscode.CustomReadonlyEditorProvider<JsonlDocument> {
  private readonly indexCache: JsonlIndexCache;
  /** Open JSONL panels, for the unified Clear cache broadcast. */
  private readonly panels = new Set<Handler>();
  private clearPending = false;

  constructor(private context: vscode.ExtensionContext) {
    this.indexCache = new JsonlIndexCache(
      path.join(context.globalStorageUri.fsPath, "jsonl-index"),
    );
    registerDataViewerCacheClearer(() => this.clearJsonlCaches());
  }

  bindCustomEditor(viewOption: CustomEditorOptions) {
    return vscode.window.registerCustomEditorProvider("GaussAA.jsonlViewer", this, viewOption);
  }

  async openCustomDocument(uri: vscode.Uri): Promise<JsonlDocument> {
    const document = new JsonlDocument(uri);
    // Only open the source; indexing happens lazily in resolveCustomEditor.
    document.pendingSource = openDocumentSource(uri);
    return document;
  }

  /** Load the cached line index when the file identity matches; build and store on a miss. */
  private async openSession(
    document: JsonlDocument,
    options?: {
      requestId?: number;
      onProgress?: (loaded: number, total: number) => void;
    },
  ): Promise<JsonlSession> {
    const fingerprint = await this.fingerprint(document.uri);
    const source = document.pendingSource
      ? await document.pendingSource
      : await openDocumentSource(document.uri);
    document.pendingSource = null;

    // Try cache hit first.
    let cachedIndex: Awaited<ReturnType<JsonlIndexCache["get"]>> = null;
    if (fingerprint) {
      try {
        cachedIndex = await this.indexCache.get(fingerprint);
      } catch {
        cachedIndex = null;
      }
    }

    if (cachedIndex) {
      // Cache hit: skip progress, use cached index directly.
      const file = await JsonlFile.open(source, cachedIndex);
      return new JsonlSession(file);
    }

    // Cache miss: show progress and build index.
    const file = await JsonlFile.open(source, undefined, {
      onProgress: options?.onProgress,
      cancel: document.cancelToken,
    });

    // Store the built index in cache.
    if (fingerprint) {
      try {
        await this.indexCache.set(fingerprint, file.index);
      } catch {
        // A cache write failure must not fail the open; the index is already in memory.
      }
    }

    return new JsonlSession(file);
  }

  private async fingerprint(uri: vscode.Uri): Promise<FileFingerprint | null> {
    if (uri.scheme !== "file") return null;
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      return { key: buildDocumentCacheId(uri), size: stat.size, mtimeMs: stat.mtime };
    } catch {
      return null;
    }
  }

  /** Clear the disk indexes and every open JSONL view; closed views consume a one-shot. */
  async clearJsonlCaches(): Promise<void> {
    await this.indexCache.clear();
    const active = [...this.panels].filter((handler) => !handler.disposed);
    for (const handler of active) handler.emit("clearJsonlCache");
    if (active.length === 0) this.clearPending = true;
  }

  private consumeClear(): boolean {
    if (!this.clearPending) return false;
    this.clearPending = false;
    return true;
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
    // Always the current session: a reload replaces it.
    const current = () => document.session;

    const handlers = createJsonlHandlers({
      session: current,
      reopen: async (options) => {
        const previous = current();
        document.session = await this.openSession(document, options);
        previous?.dispose();
      },
      emit: (type, payload) => handler.emit(type, payload),
      info: () => ({
        fileName: document.uri.path.split("/").pop() ?? document.uri.fsPath,
        cacheId: buildDocumentCacheId(document.uri),
        lineCount: current()?.lineCount ?? 0,
        byteSize: current()?.byteSize ?? 0,
        ...(this.consumeClear() ? { clearCache: true } : {}),
      }),
    });

    this.panels.add(handler);
    webviewPanel.onDidDispose(() => this.panels.delete(handler));

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
