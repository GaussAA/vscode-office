import * as vscode from "vscode";
import { basename, join, parse } from "path";
import { Handler } from "@/common/handler";
import { normalizeExternalUrl } from "@/common/externalLink";
import { isUriReadOnly } from "@/common/fileReadOnly";
import { Uri, workspace } from "vscode";
import {
  emitFileOfficeOpen,
  emitVirtualOfficeOpen,
  isVirtualUri,
} from "@/provider/handlers/officeContent";
import { createSaveHandlers, type SaveAsPayload, type SaveTracker } from "./saveHandlers";

function setDirty(handler: Handler, uri: Uri, dirty: boolean) {
  const panel = handler.panel;
  const fileName = basename(uri.fsPath);
  panel.title = dirty ? `${fileName}*` : fileName;
  if (dirty) {
    void vscode.commands.executeCommand("workbench.action.keepEditor");
  }
}

/**
 * @param saves who wrote what and when. The provider owns it and shares one instance between
 * its panels; the save rules themselves are in `saveHandlers`.
 */
export function handleCommonEvent(
  uri: Uri,
  handler: Handler,
  saves: SaveTracker,
  options: { clearCache?: boolean; hostWorkbook?: boolean } = {},
) {
  let readOnly = false;
  // One-shot: the first successful open may clear; a later fileChange must not clear again.
  let clearCache = options.clearCache === true;

  const send = async () => {
    if (saves.shouldSkip(uri.toString())) {
      return;
    }
    readOnly = await isUriReadOnly(uri);
    // The webview is about to replace its document, dropping unsaved edits.
    saveHandlers.opened();
    const sendClear = clearCache;
    clearCache = false;
    if (isVirtualUri(uri)) {
      void emitVirtualOfficeOpen(handler, uri, { clearCache: sendClear });
      return;
    }
    await emitFileOfficeOpen(handler, uri, handler.panel.webview, {
      clearCache: sendClear,
      hostWorkbook: options.hostWorkbook,
    });
  };
  const saveHandlers = createSaveHandlers<Uri>({
    document: uri,
    baseName: parse(uri.fsPath).name,
    saves,
    keyOf: (target) => target.toString(),
    isReadOnly: () => readOnly,
    writeFile: (target, bytes) => workspace.fs.writeFile(target, bytes),
    pickTarget: ({ defaultFileName, filters }) => {
      const defaultUri =
        uri.scheme === "file"
          ? Uri.file(join(parse(uri.fsPath).dir, defaultFileName))
          : Uri.joinPath(uri, "..", defaultFileName);
      return vscode.window.showSaveDialog({ defaultUri, filters });
    },
    setDirty: (dirty) => setDirty(handler, uri, dirty),
    openTarget: (target) =>
      vscode.commands.executeCommand("vscode.openWith", target, "GaussAA.officeViewer"),
    emit: (type, payload) => handler.emit(type, payload),
  });
  const events = handler.on("editInVSCode", (full: boolean) => {
    const side = full ? vscode.ViewColumn.Active : vscode.ViewColumn.Beside;
    vscode.commands.executeCommand("vscode.openWith", uri, "default", side);
  });
  events
    .on("init", () => {
      void send();
    })
    .on("fileChange", () => {
      void send();
    })
    .on("change", () => {
      saveHandlers.edited();
    })
    .on("openForce", async () => {
      // The webview's size guard said "open anyway". A `file:` document is fetched by the
      // webview itself, so only a virtual one needs the host to read it again — this time
      // without the guard.
      if (isVirtualUri(uri)) {
        await emitVirtualOfficeOpen(handler, uri, { force: true });
      }
    })
    .on("save", (content) => saveHandlers.save(content))
    .on("saveAs", (payload: SaveAsPayload) => saveHandlers.saveAs(payload))
    .on("developerTool", () => vscode.commands.executeCommand("workbench.action.toggleDevTools"))
    .on("revealFile", async () => {
      // The one exit a broken file actually has. A virtual document has nothing to reveal, and
      // the command rejects for it — say so instead of failing silently behind the error pane.
      try {
        await vscode.commands.executeCommand("revealFileInOS", uri);
      } catch {
        void vscode.window.showWarningMessage("This file has no location in the file explorer.");
      }
    })

    .on("openExternal", (url: string) => {
      // The webview is not trusted. Re-validate at the only place that can actually ask the
      // operating system to open something: http(s) only, no userinfo, no control characters.
      const safe = normalizeExternalUrl(url);
      if (safe) {
        void vscode.env.openExternal(vscode.Uri.parse(safe));
      }
    })
    .on("dispose", () => {
      saves.forget(uri.toString());
    });
}
