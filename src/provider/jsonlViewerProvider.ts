import * as vscode from 'vscode';
import { Handler } from '@/common/handler';
import { ReactApp } from '@/common/reactApp';
import { getExtensionResourceRoots } from '@/common/extensionResource';
import { buildDocumentCacheId } from '@/provider/handlers/officeContent';
import { JsonlFile, fileByteSource, memoryByteSource, type ByteSource } from '@/service/jsonlFile';
import { JsonlSession } from '@/service/jsonlSession';
import {
    JSONL_CHUNK_SIZE,
    type JsonlEntriesPayload,
    type JsonlEntryPayload,
    type JsonlEntryRequest,
    type JsonlInfoPayload,
    type JsonlRangeRequest,
    type JsonlSearchBatch,
    type JsonlSearchCancel,
    type JsonlSearchRequest,
} from '@/common/jsonlTypes';

/**
 * Random access to the document's bytes.
 *
 * A real file is opened once and read in chunks, so a 500 MB log costs one chunk of memory
 * plus the line index. Anything else (virtual documents, remote workspaces) is read whole —
 * the bytes are already the only way to reach them.
 */
async function openByteSource(uri: vscode.Uri): Promise<ByteSource> {
    if (uri.scheme === 'file') return fileByteSource(uri.fsPath);
    return memoryByteSource(await vscode.workspace.fs.readFile(uri));
}

class JsonlDocument implements vscode.CustomDocument {

    constructor(
        public readonly uri: vscode.Uri,
        public session: JsonlSession,
    ) { }

    dispose(): void {
        this.session.dispose();
    }
}

/**
 * JSONL viewer: one line is one self-describing JSON document, so the preview
 * surface is a two-pane layout — a directory of entries on the left, the full
 * tree of the selected entry on the right. Never a table: heterogeneous keys
 * would force a schema that does not exist.
 */
export class JsonlViewerProvider implements vscode.CustomReadonlyEditorProvider<JsonlDocument> {

    constructor(private context: vscode.ExtensionContext) { }

    bindCustomEditor(viewOption: { webviewOptions: vscode.WebviewPanelOptions }) {
        return vscode.window.registerCustomEditorProvider('chaowu21.jsonlViewer', this, viewOption);
    }

    async openCustomDocument(uri: vscode.Uri): Promise<JsonlDocument> {
        const file = await JsonlFile.open(await openByteSource(uri));
        return new JsonlDocument(uri, new JsonlSession(file));
    }

    async resolveCustomEditor(document: JsonlDocument, webviewPanel: vscode.WebviewPanel): Promise<void> {
        const webview = webviewPanel.webview;
        const folderPath = vscode.Uri.joinPath(document.uri, '..');
        webview.options = {
            enableScripts: true,
            localResourceRoots: [...getExtensionResourceRoots(this.context), folderPath],
        };

        const handler = Handler.bind(webviewPanel, document.uri);
        // Always the current session: a reload replaces it.
        const current = () => document.session;

        const emitInfo = () => {
            const session = current();
            const payload: JsonlInfoPayload = {
                fileName: document.uri.path.split('/').pop() ?? document.uri.fsPath,
                cacheId: buildDocumentCacheId(document.uri),
                lineCount: session.lineCount,
                byteSize: session.byteSize,
            };
            handler.emit('jsonlInfo', payload);
        };

        /** The file changed on disk: index the new bytes, then close the old view. */
        const reload = async () => {
            const previous = current();
            document.session = new JsonlSession(await JsonlFile.open(await openByteSource(document.uri)));
            previous.dispose();
            emitInfo();
        };

        handler
            .on('init', () => { emitInfo() })
            .on('jsonlReload', () => reload())
            .on('fileChange', () => reload())
            .on('jsonlIndex', async (request: JsonlRangeRequest) => {
                if (typeof request?.requestId !== 'number') return;
                const start = Math.max(0, request.start ?? 0);
                const end = request.end ?? start + JSONL_CHUNK_SIZE;
                let payload: JsonlEntriesPayload;
                try {
                    payload = await current().readRange(request.requestId, start, end);
                } catch {
                    return; // the file was swapped underneath us; the webview will ask again
                }
                handler.emit('jsonlEntries', payload);
            })
            .on('jsonlEntry', async (request: JsonlEntryRequest) => {
                if (typeof request?.requestId !== 'number') return;
                let payload: JsonlEntryPayload | null = null;
                try {
                    payload = await current().readEntry(request.requestId, request.index);
                } catch {
                    return;
                }
                if (payload) handler.emit('jsonlEntryData', payload);
            })
            .on('jsonlSearch', (request: JsonlSearchRequest) => {
                if (typeof request?.requestId !== 'number') return;
                // A newer search supersedes the running one; the session stops it on its next turn.
                document.session.cancelSearch();
                document.session.search(request.requestId, request.query, {
                    onBatch: (batch: JsonlSearchBatch) => { handler.emit('jsonlSearchBatch', batch); },
                });
            })
            .on('jsonlSearchCancel', (_request: JsonlSearchCancel) => { document.session.cancelSearch(); });

        await ReactApp.view(webview, { route: 'jsonl' });
    }
}
