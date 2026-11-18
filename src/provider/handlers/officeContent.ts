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
 * Byte size and last-modified time of the document, or no answer when the scheme cannot say.
 *
 * The webview needs the size to decide whether to parse, the host needs it to decide whether
 * to read a virtual document at all — a 100 MB file that has to travel through a `postMessage`
 * as `number[]` is worse than an extra stat. The mtime is the second half of the parquet share
 * cache fingerprint: without it a cached scan cannot be validated, so it is only reported when
 * the stat really succeeded.
 */
async function statDocument(uri: Uri): Promise<{ size?: number; mtimeMs?: number }> {
  try {
    const stat = await workspace.fs.stat(uri);
    return { size: stat.size, mtimeMs: stat.mtime };
  } catch {
    return {};
  }
}

export interface VirtualOpenOptions {
  /** The user answered "open anyway": skip the size guard and read the bytes. */
  force?: boolean;
  /** Clear parquet-derived caches in the webview before it renders this document. */
  clearCache?: boolean;
}

export async function emitVirtualOfficeOpen(
  handler: Handler,
  uri: Uri,
  options: VirtualOpenOptions = {},
): Promise<void> {
  const now = Date.now();
  const ext = extname(uri.fsPath);
  const readOnly = await isUriReadOnly(uri);
  const { size, mtimeMs } = await statDocument(uri);
  const payload: OfficeOpenMessage = {
    ext,
    path: getPayloadPath(uri),
    fileName: basename(uri.fsPath),
    scheme: uri.scheme,
    documentCacheId: buildDocumentCacheId(uri),
    readOnly,
    size,
    mtimeMs,
    nonce: now,
    ...(options.clearCache ? { clearCache: true } : {}),
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
  options: { clearCache?: boolean; hostWorkbook?: boolean } = {},
): Promise<void> {
  // The webview fetches the bytes itself for this scheme, so the size only informs its size
  // guard and the two stat fields are the share cache's fingerprint; the host never reads the
  // file here.
  const { size, mtimeMs } = await statDocument(uri);
  const payload: OfficeOpenMessage = {
    ext: extname(uri.fsPath),
    path: webview.asWebviewUri(uri).toString(),
    fileName: basename(uri.fsPath),
    scheme: uri.scheme,
    documentCacheId: buildDocumentCacheId(uri),
    readOnly: await isUriReadOnly(uri),
    size,
    mtimeMs,
    ...(options.clearCache ? { clearCache: true } : {}),
    ...(options.hostWorkbook ? { hostWorkbook: true } : {}),
  };
  handler.emit("open", payload);
}
