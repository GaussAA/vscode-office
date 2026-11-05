import * as vscode from 'vscode';
import { Handler } from '@/common/handler';
import { ReactApp } from '@/common/reactApp';
import { getExtensionResourceRoots } from '@/common/extensionResource';
import { buildDocumentCacheId } from '@/provider/handlers/officeContent';
import { buildJsonlIndex } from '@/service/jsonlDocument';
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
 * The document's bytes live here, in the extension host, for its whole lifetime.
 * The webview only ever sees parsed payloads (see common/jsonlTypes.ts).
 */
class JsonlDocument implements vscode.CustomDocument {

    constructor(
        public readonly uri: vscode.Uri,
        public session: JsonlSession,
    ) { }

    dispose(): void {
        this.session.cancelSearch();
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
        const bytes = await vscode.workspace.fs.readFile(uri);
        return new JsonlDocument(uri, new JsonlSession(bytes, buildJsonlIndex(bytes)));
    }

    async resolveCustomEditor(document: JsonlDocument, webviewPanel: vscode.WebviewPanel): Promise<void> {
        const webview = webviewPanel.webview;
        const folderPath = vscode.Uri.joinPath(document.uri, '..');
        webview.options = {
            enableScripts: true,
            localResourceRoots: [...getExtensionResourceRoots(this.context), folderPath],
        };

        const handler = Handler.bind(webviewPanel, document.uri);
        const session = document.session;

        const emitInfo = () => {
            const payload: JsonlInfoPayload = {
                fileName: document.uri.path.split('/').pop() ?? document.uri.fsPath,
                cacheId: buildDocumentCacheId(document.uri),
                lineCount: session.lineCount,
                byteSize: session.byteSize,
            };
            handler.emit('jsonlInfo', payload);
        };

        const reload = async () => {
            const bytes = await vscode.workspace.fs.readFile(document.uri);
            session.reload(bytes, buildJsonlIndex(bytes));
            emitInfo();
        };

        handler
            .on('init', () => { emitInfo() })
            .on('jsonlReload', () => { void reload() })
            .on('fileChange', () => { void reload() })
            .on('jsonlIndex', (request: JsonlRangeRequest) => {
                if (typeof request?.requestId !== 'number') return;
                const start = Math.max(0, request.start ?? 0);
                const end = request.end ?? start + JSONL_CHUNK_SIZE;
                const payload: JsonlEntriesPayload = session.readRange(request.requestId, start, end);
                handler.emit('jsonlEntries', payload);
            })
            .on('jsonlEntry', (request: JsonlEntryRequest) => {
                if (typeof request?.requestId !== 'number') return;
                const payload: JsonlEntryPayload | null = session.readEntry(request.requestId, request.index);
                if (payload) handler.emit('jsonlEntryData', payload);
            })
            .on('jsonlSearch', (request: JsonlSearchRequest) => {
                if (typeof request?.requestId !== 'number') return;
                // A newer search supersedes the running one; the session stops it on its next turn.
                session.cancelSearch();
                session.search(request.requestId, request.query, {
                    onBatch: (batch: JsonlSearchBatch) => { handler.emit('jsonlSearchBatch', batch); },
                });
            })
            .on('jsonlSearchCancel', (_request: JsonlSearchCancel) => { session.cancelSearch(); });

        await ReactApp.view(webview, { route: 'jsonl' });
    }
}
