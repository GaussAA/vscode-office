import * as vscode from 'vscode';
import { Handler } from '@/common/handler';
import { ReactApp } from '@/common/reactApp';
import { getExtensionResourceRoots } from '@/common/extensionResource';
import { buildDocumentCacheId } from '@/provider/handlers/officeContent';
import { JsonlFile } from '@/service/jsonlFile';
import { JsonlSession } from '@/service/jsonlSession';
import { openByteSource } from '@/service/jsonlSource';
import { createJsonlHandlers } from './jsonlHandlers';

/** Non-file documents (virtual, remote) can only be read whole. */
const readAll = async (uri: { scheme: string; fsPath: string }) =>
    vscode.workspace.fs.readFile(uri as vscode.Uri);

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
        const file = await JsonlFile.open(await openByteSource(uri, readAll));
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

        const handlers = createJsonlHandlers({
            session: current,
            reopen: async () => {
                const previous = current();
                document.session = new JsonlSession(await JsonlFile.open(await openByteSource(document.uri, readAll)));
                previous.dispose();
            },
            emit: (type, payload) => handler.emit(type, payload),
            info: () => ({
                fileName: document.uri.path.split('/').pop() ?? document.uri.fsPath,
                cacheId: buildDocumentCacheId(document.uri),
                lineCount: current().lineCount,
                byteSize: current().byteSize,
            }),
        });

        handler
            .on('init', () => handlers.init())
            .on('jsonlReload', () => handlers.reload())
            .on('fileChange', () => handlers.reload())
            .on('jsonlIndex', request => handlers.index(request))
            .on('jsonlEntry', request => handlers.entry(request))
            .on('jsonlSearch', request => handlers.search(request))
            .on('jsonlSearchCancel', request => handlers.cancelSearch(request));

        await ReactApp.view(webview, { route: 'jsonl' });
    }
}
