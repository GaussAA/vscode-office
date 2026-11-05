import * as vscode from 'vscode';
import { Handler } from '@/common/handler';
import { ReactApp } from '@/common/reactApp';
import { getExtensionResourceRoots } from '@/common/extensionResource';
import { isUriReadOnly } from '@/common/fileReadOnly';
import {
    buildJsonlEntry,
    buildJsonlIndex,
    buildJsonlSummaries,
    type JsonlIndex,
} from '@/service/jsonlDocument';
import {
    JSONL_CHUNK_SIZE,
    type JsonlEntryPayload,
    type JsonlInfoPayload,
    type JsonlRangeRequest,
} from '@/common/jsonlTypes';

/**
 * The document's bytes live here, in the extension host, for its whole lifetime.
 * The webview only ever sees parsed payloads (see common/jsonlTypes.ts).
 */
class JsonlDocument implements vscode.CustomDocument {

    constructor(
        public readonly uri: vscode.Uri,
        public bytes: Uint8Array,
        public index: JsonlIndex,
    ) { }

    dispose(): void {
        this.bytes = new Uint8Array(0);
        this.index = { offsets: [], lineCount: 0 };
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
        return new JsonlDocument(uri, bytes, buildJsonlIndex(bytes));
    }

    async resolveCustomEditor(document: JsonlDocument, webviewPanel: vscode.WebviewPanel): Promise<void> {
        const webview = webviewPanel.webview;
        const folderPath = vscode.Uri.joinPath(document.uri, '..');
        webview.options = {
            enableScripts: true,
            localResourceRoots: [...getExtensionResourceRoots(this.context), folderPath],
        };

        const handler = Handler.bind(webviewPanel, document.uri);

        const emitInfo = async () => {
            const payload: JsonlInfoPayload = {
                fileName: document.uri.path.split('/').pop() ?? document.uri.fsPath,
                cacheId: `${document.uri.scheme}:${document.uri.toString()}`,
                lineCount: document.index.lineCount,
                byteSize: document.bytes.byteLength,
                readOnly: await isUriReadOnly(document.uri),
            };
            handler.emit('jsonlInfo', payload);
        };

        const reload = async () => {
            const bytes = await vscode.workspace.fs.readFile(document.uri);
            document.bytes = bytes;
            document.index = buildJsonlIndex(bytes);
            await emitInfo();
        };

        handler
            .on('init', () => { void emitInfo(); })
            .on('jsonlReload', () => { void reload(); })
            .on('fileChange', () => { void reload(); })
            .on('jsonlIndex', (range: JsonlRangeRequest) => {
                const start = Math.max(0, range?.start ?? 0);
                const end = Math.min(
                    range?.end ?? start + JSONL_CHUNK_SIZE,
                    document.index.lineCount,
                );
                handler.emit('jsonlEntries', {
                    start,
                    entries: buildJsonlSummaries(document.bytes, document.index, start, end),
                });
            })
            .on('jsonlEntry', (index: number) => {
                if (typeof index !== 'number' || index < 0 || index >= document.index.lineCount) {
                    return;
                }
                const payload: JsonlEntryPayload = {
                    index,
                    entry: buildJsonlEntry(document.bytes, document.index, index),
                };
                handler.emit('jsonlEntryData', payload);
            });

        await ReactApp.view(webview, { route: 'jsonl' });
    }
}
