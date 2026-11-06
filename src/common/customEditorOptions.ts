import type * as vscode from "vscode";

/**
 * Options shared by every custom editor registration.
 *
 * `supportsMultipleEditorsPerDocument` was never turned on, so opening the same file in a
 * second editor group could not give you a second viewer. The VS Code docs recommend
 * enabling it for read-only previewers, and it costs nothing here: no provider keeps
 * per-editor state — the document owns it (`openCustomDocument`), and `resolveCustomEditor`
 * is free to run more than once against the same document.
 *
 * `retainContextWhenHidden` is deliberately **not** set. It was on for all eight viewers,
 * which kept every hidden tab's DOM and JS heap alive — the docs call it expensive and say
 * it should not be the default. What it was buying us is now covered explicitly:
 *   - the parquet viewer remembers the page per document (`localStorage`, keyed by path);
 *   - the JSONL viewer remembers selection, split width and mode the same way;
 *   - the rest rebuild cheaply from the document on `resolveCustomEditor`.
 * The two dedicated panels that still keep it (git history, HTML preview) say why on site.
 */
export type CustomEditorOptions = {
  webviewOptions?: vscode.WebviewPanelOptions;
  supportsMultipleEditorsPerDocument?: boolean;
};

export const customEditorOptions: CustomEditorOptions = {
  supportsMultipleEditorsPerDocument: true,
};
