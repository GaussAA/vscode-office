import * as vscode from "vscode";
import type { ByteSource } from "@/service/jsonlFile";
import { openByteSource } from "@/service/jsonlSource";

/**
 * Open a document's bytes for the JSONL viewer, the parquet viewer and the comparison panel.
 * A `file:` document is random-read; anything else (virtual, remote) can only be read whole,
 * which is the one thing `readAll` says, here and nowhere else.
 */
export function openDocumentSource(uri: vscode.Uri): Promise<ByteSource> {
  return openByteSource(uri, async (target) => vscode.workspace.fs.readFile(target as vscode.Uri));
}
