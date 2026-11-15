import { basename, extname } from "path";
import { Uri, workspace, type Webview } from "vscode";
import { Handler } from "@/common/handler";
import { isUriReadOnly } from "@/common/fileReadOnly";
import { isOverPreviewLimit } from "@/common/previewLimit";
import { encodeBase64 } from "@/common/base64";
import type { OfficeOpenMessage } from "@/common/openPayload";

export function isVirtualUri(uri: Uri): boolean {
  return uri.scheme !== "file";
}

function getPayloadPath(uri: Uri): string {
  return uri.toString();
}

/** 与 markdown documentCacheId 一致，用于 webview localStorage 键前缀 */
export function buildDocumentCacheId(uri: Uri): string {
  return `${uri.scheme}:${uri.toString()}`;
}

/**
 * Byte size of the document, or undefined when the scheme cannot answer.
 *
 * The webview needs it to decide whether to parse, and the host needs it to decide whether to
 * read a virtual document at all — a 100 MB file that has to travel through a `postMessage`
 * as `number[]` is worse than an extra stat.
 */
async function statSize(uri: Uri): Promise<number | undefined> {
  try {
    const stat = await workspace.fs.stat(uri);
    return stat.size;
  } catch {
    return undefined;
  }
}

export interface VirtualOpenOptions {
  /** The user answered "open anyway": skip the size guard and read the bytes. */
  force?: boolean;
}

export async function emitVirtualOfficeOpen(
  handler: Handler,
  uri: Uri,
  options: VirtualOpenOptions = {},
): Promise<void> {
  const now = Date.now();
  const ext = extname(uri.fsPath);
  const readOnly = await isUriReadOnly(uri);
  const size = await statSize(uri);
  const payload: OfficeOpenMessage = {
    ext,
    path: getPayloadPath(uri),
    fileName: basename(uri.fsPath),
    scheme: uri.scheme,
    documentCacheId: buildDocumentCacheId(uri),
    readOnly,
    size,
    nonce: now,
  };
  // A virtual document has to be read whole and shipped as `number[]`, so this is the one
  // place where refusing early saves the expensive part of the work rather than a parse.
  if (!options.force && isOverPreviewLimit(ext, size)) {
    handler.emit("open", { ...payload, tooLarge: true });
    return;
  }
  try {
    const data = await workspace.fs.readFile(uri);
    handler.emit("open", { ...payload, bufferBase64: encodeBase64(data) });
  } catch (error) {
    handler.emit("open", {
      ...payload,
      error: error instanceof Error ? error.message : "Failed to read file",
    });
  }
}

export async function emitFileOfficeOpen(
  handler: Handler,
  uri: Uri,
  webview: Webview,
): Promise<void> {
  const payload: OfficeOpenMessage = {
    ext: extname(uri.fsPath),
    path: webview.asWebviewUri(uri).toString(),
    fileName: basename(uri.fsPath),
    scheme: uri.scheme,
    documentCacheId: buildDocumentCacheId(uri),
    readOnly: await isUriReadOnly(uri),
    // The webview fetches the bytes itself for this scheme, so the size only informs its
    // size guard; the host never reads the file.
    size: await statSize(uri),
  };
  handler.emit("open", payload);
}
