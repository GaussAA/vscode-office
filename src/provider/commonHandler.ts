import * as vscode from "vscode";
import { Handler } from "@/common/handler";
import { normalizeExternalUrl } from "@/common/externalLink";
import { Uri } from "vscode";
import {
  emitFileOfficeOpen,
  emitVirtualOfficeOpen,
  isVirtualUri,
} from "@/provider/handlers/officeContent";

/**
 * The messages every viewer answers the same way: lifecycle, the escape hatches, and the
 * external-link filter.
 *
 * @param clearCache set by Clear cache when it ran with no panel of this viewer open; the
 * first open carries the one-shot flag so the webview can drop stale stored state.
 */
export function handleCommonEvent(
  uri: Uri,
  handler: Handler,
  options: { clearCache?: boolean } = {},
) {
  // One-shot: the first successful open may clear; a later fileChange must not clear again.
  let clearCache = options.clearCache === true;

  const send = async () => {
    const sendClear = clearCache;
    clearCache = false;
    if (isVirtualUri(uri)) {
      void emitVirtualOfficeOpen(handler, uri, { clearCache: sendClear });
      return;
    }
    await emitFileOfficeOpen(handler, uri, handler.panel.webview, { clearCache: sendClear });
  };
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
    .on("openForce", async () => {
      // The webview's size guard said "open anyway". A `file:` document is fetched by the
      // webview itself, so only a virtual one needs the host to read it again — this time
      // without the guard.
      if (isVirtualUri(uri)) {
        await emitVirtualOfficeOpen(handler, uri, { force: true });
      }
    })
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
    // The file watcher and the message channel belong to `Handler.bind`, which closes them when
    // the panel is disposed. Nothing is kept per document here, so this only keeps the event
    // name documented for anyone adding per-document state later.
    .on("dispose", () => {});
}
