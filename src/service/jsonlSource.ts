/**
 * Which byte source a document gets, decided without `vscode`.
 *
 * A `file:` document can be random-read in chunks (peak memory is one chunk, whatever the
 * file size); anything else — virtual documents, remote workspaces — has to be read whole,
 * because the bytes are the only way to reach it. The provider used to make this choice
 * inline, where no test could reach it: `verify:ui` stubs `acquireVsCodeApi`, so the scheme
 * branch was the one decision in the JSONL path with no automated coverage.
 */
import { fileByteSource, memoryByteSource, type ByteSource } from './jsonlFile';

/** The slice of `vscode.Uri` this decision needs. */
export interface UriLike {
    scheme: string;
    fsPath: string;
}

/**
 * @param readAll how to fetch a non-file document; the caller owns that (`workspace.fs`).
 */
export async function openByteSource(
    uri: UriLike,
    readAll: (uri: UriLike) => Promise<Uint8Array>,
): Promise<ByteSource> {
    if (uri.scheme === 'file') return fileByteSource(uri.fsPath);
    return memoryByteSource(await readAll(uri));
}
