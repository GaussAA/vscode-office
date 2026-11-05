import { basename } from "path";
import { Uri, ViewColumn, window, type ExtensionContext } from "vscode";
import { Util } from "../common/util";
import { extensionResource, getExtensionResourceRoots } from "../common/extensionResource";
import { readUriText } from "../common/workspaceFs";
import { i18n } from "@/common/global";
import { PREVIEW_CONTENT_TYPE, PREVIEW_READY_TYPE, buildHtmlPreviewShell } from "./htmlPreviewShell";

export class HtmlService {

    public static previewHtml(uri: Uri, context: ExtensionContext) {
        const activeEditor = window.activeTextEditor;
        if (!uri) {
            if (!activeEditor) {
                void window.showWarningMessage(i18n('ext.html.noFile'));
                return;
            }
            uri = activeEditor.document.uri;
        }
        const folderUri = Uri.joinPath(uri, '..');
        const webviewPanel = window.createWebviewPanel(
            "office-viewer.viewHtml", basename(uri.fsPath),
            { viewColumn: ViewColumn.Two, preserveFocus: true },
            {
                retainContextWhenHidden: true,
                enableScripts: true,
                localResourceRoots: [...getExtensionResourceRoots(context), folderUri],
            }
        )

        // The document itself never reaches `webview.html`; it is handed to the sandboxed
        // frame inside the shell once that frame reports it is listening.
        let latest: string | undefined;
        let ready = false;

        const push = () => {
            if (!ready || latest === undefined) return;
            void webviewPanel.webview.postMessage({ type: PREVIEW_CONTENT_TYPE, html: latest });
        };

        const render = async () => {
            const useActiveEditor = activeEditor?.document.uri.toString() === uri.toString();
            const content = useActiveEditor
                ? activeEditor.document.getText()
                : await readUriText(uri);
            latest = Util.buildPath(content, webviewPanel.webview, folderUri);
            push();
        };

        webviewPanel.iconPath = extensionResource(context, 'icons', 'html.svg');
        webviewPanel.webview.html = buildHtmlPreviewShell();
        const messageSubscription = webviewPanel.webview.onDidReceiveMessage(message => {
            if (message?.type !== PREVIEW_READY_TYPE) return;
            ready = true;
            push();
        });
        webviewPanel.onDidDispose(() => messageSubscription.dispose());
        void render();

        Util.listen(webviewPanel, uri, () => { void render(); })
    }

}
