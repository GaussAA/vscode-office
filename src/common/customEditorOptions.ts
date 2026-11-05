import type * as vscode from 'vscode';

/**
 * Options shared by every custom editor registration.
 *
 * `supportsMultipleEditorsPerDocument` was never turned on, so opening the same file in a
 * second editor group could not give you a second viewer. The VS Code docs now recommend
 * enabling it for read-only previewers, and it costs nothing here: no provider keeps
 * per-editor state — the document owns it (`openCustomDocument`), and `resolveCustomEditor`
 * is free to run more than once against the same document.
 */
export type CustomEditorOptions = {
	webviewOptions?: vscode.WebviewPanelOptions;
	supportsMultipleEditorsPerDocument?: boolean;
};

export const customEditorOptions: CustomEditorOptions = {
	webviewOptions: { retainContextWhenHidden: true },
	supportsMultipleEditorsPerDocument: true,
};
