/**
 * Two-file comparison panel (ADR-0021).
 *
 * A **Command preview**: the command asks for two files, nothing is registered against a file
 * pattern, and the panel never becomes an editor for either of them. It reads each file's
 * footer once (through the ADR-0020 seam) and answers a pure diff — no column is decoded, so
 * the pair can be 377 MB each and still open instantly. Which side failed and how the answer
 * is built are in `compareHandlers`; this file is the panel and the wiring.
 */
import * as vscode from "vscode";
import { Handler } from "@/common/handler";
import { ReactApp } from "@/common/reactApp";
import { getExtensionResourceRoots } from "@/common/extensionResource";
import { createCompareHandlers } from "./compareHandlers";
import { openDocumentSource } from "./documentSource";

const VIEW_TYPE = "GaussAA.compareParquet";
const COMMAND = "GaussAA.office.compareParquet";

function fileNameOf(uri: vscode.Uri): string {
  return uri.path.split("/").pop() ?? uri.fsPath;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

class ComparePanel {
  static open(context: vscode.ExtensionContext, left: vscode.Uri, right: vscode.Uri) {
    const panel = vscode.window.createWebviewPanel(
      VIEW_TYPE,
      `${fileNameOf(left)} ↔ ${fileNameOf(right)}`,
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        localResourceRoots: [...getExtensionResourceRoots(context)],
      },
    );
    return new ComparePanel(panel, left, right);
  }

  private constructor(panel: vscode.WebviewPanel, left: vscode.Uri, right: vscode.Uri) {
    const handler = Handler.bind(panel, left);
    const handlers = createCompareHandlers({
      left: { fileName: fileNameOf(left), open: () => openDocumentSource(left) },
      right: { fileName: fileNameOf(right), open: () => openDocumentSource(right) },
      emit: (type, payload) => handler.emit(type, payload),
    });
    handler
      .on("init", () => void handlers.init())
      .on("compareReload", (request) => handlers.reload(request));
    void ReactApp.view(panel.webview, { route: "compare" });
  }
}
async function pick(label: string): Promise<vscode.Uri | undefined> {
  const picked = await vscode.window.showOpenDialog({
    canSelectMany: false,
    openLabel: label,
    filters: { Parquet: ["parquet"] },
  });
  return picked?.[0];
}

/**
 * Register the command. `package.json` contributes it; there is no custom editor and no file
 * pattern, which is what keeps this a Command preview rather than a fourth viewer.
 */
export function activateCompare(context: vscode.ExtensionContext): void {
  const command = vscode.commands.registerCommand(COMMAND, async () => {
    try {
      const left = await pick("Compare: choose the left file (usually the older one)");
      if (!left) return;
      const right = await pick("Compare: choose the right file (usually the newer one)");
      if (!right) return;
      ComparePanel.open(context, left, right);
    } catch (error) {
      void vscode.window.showErrorMessage(messageOf(error));
    }
  });
  context.subscriptions.push(command);
}
