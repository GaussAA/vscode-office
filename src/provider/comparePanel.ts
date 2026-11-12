/**
 * Two-file comparison panel (ADR-0021).
 *
 * A **Command preview**: the command asks for two files, nothing is registered against a file
 * pattern, and the panel never becomes an editor for either of them. It reads each file's
 * footer once (through the ADR-0020 seam) and answers a pure diff — no column is decoded, so
 * the pair can be 377 MB each and still open instantly.
 */
import * as vscode from "vscode";
import { Handler } from "@/common/handler";
import { ReactApp } from "@/common/reactApp";
import { getExtensionResourceRoots } from "@/common/extensionResource";
import type { NamedParquetProfile, ParquetComparePayload } from "@/common/parquetCompareTypes";
import type { ByteSource } from "@/service/jsonlFile";
import { openByteSource } from "@/service/jsonlSource";
import { compareParquetProfiles } from "@/service/parquetCompare";
import { readParquetProfile } from "@/service/parquetProfile";

const VIEW_TYPE = "GaussAA.compareParquet";
const COMMAND = "GaussAA.office.compareParquet";

/** Non-file documents can only be read whole; the same rule the JSONL viewer uses. */
const readAll = async (uri: { scheme: string; fsPath: string }) =>
  vscode.workspace.fs.readFile(uri as vscode.Uri);

function fileNameOf(uri: vscode.Uri): string {
  return uri.path.split("/").pop() ?? uri.fsPath;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function profileOf(uri: vscode.Uri): Promise<NamedParquetProfile> {
  const source: ByteSource = await openByteSource(uri, readAll);
  try {
    return { fileName: fileNameOf(uri), profile: await readParquetProfile(source) };
  } finally {
    await source.close?.();
  }
}

class ComparePanel {
  private readonly handler: Handler;

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

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly left: vscode.Uri,
    private readonly right: vscode.Uri,
  ) {
    this.handler = Handler.bind(panel, left);
    this.handler
      .on("init", () => void this.answer(0))
      .on("compareReload", (request?: { requestId?: number }) =>
        this.answer(typeof request?.requestId === "number" ? request.requestId : 0),
      );
    void ReactApp.view(panel.webview, { route: "compare" });
  }

  /**
   * Read both sides and answer.
   *
   * The sides are read separately so a failure can name the file that failed: "the left one
   * could not be read" sends the reader to the right place, "comparison failed" does not.
   */
  private async answer(requestId: number) {
    let left: NamedParquetProfile;
    try {
      left = await profileOf(this.left);
    } catch (error) {
      this.fail(requestId, "left", error);
      return;
    }
    let right: NamedParquetProfile;
    try {
      right = await profileOf(this.right);
    } catch (error) {
      this.fail(requestId, "right", error);
      return;
    }
    this.handler.emit("compareData", {
      requestId,
      compare: compareParquetProfiles(left, right),
    } satisfies ParquetComparePayload);
  }

  private fail(requestId: number, failedSide: "left" | "right", error: unknown) {
    this.handler.emit("compareData", {
      requestId,
      compare: null,
      failedSide,
      error: messageOf(error),
    } satisfies ParquetComparePayload);
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
