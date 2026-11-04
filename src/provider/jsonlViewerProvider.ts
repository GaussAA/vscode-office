import * as vscode from 'vscode';
import { Handler } from '@/common/handler';
import { ReactApp } from '@/common/reactApp';
import { getExtensionResourceRoots } from '@/common/extensionResource';
import { isUriReadOnly } from '@/common/fileReadOnly';
import { buildJsonlIndex, buildJsonlLines, type JsonlIndex } from '@/service/jsonlDocument';
import { JSONL_WINDOW_SIZE, type JsonlInfoPayload, type JsonlReadRequest } from '@/common/jsonlTypes';

/**
 * The document's bytes live here, in the extension host, for its whole lifetime.
 * The webview only ever sees parsed line payloads (see common/jsonlTypes.ts).
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
 * surface is a tree (never a table — heterogeneous keys would force a fake schema).
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
            .on('jsonlRead', (range: JsonlReadRequest) => {
                const start = Math.max(0, range?.start ?? 0);
                const end = Math.min(range?.end ?? start + JSONL_WINDOW_SIZE, document.index.lineCount);
                handler.emit('jsonlLines', {
                    start,
                    lines: buildJsonlLines(document.bytes, document.index, start, end),
                });
            });

        await ReactApp.view(webview, { route: 'jsonl' });
    }
}
