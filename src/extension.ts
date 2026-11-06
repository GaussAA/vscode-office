import * as vscode from 'vscode';
import { customEditorOptions } from '@/common/customEditorOptions';
import { Global } from './common/global';
import { JavaDecompilerProvider } from './provider/javaDecompilerProvider';
import { MarkdownEditorProvider } from './provider/markdownEditorProvider';
import { OfficeViewerProvider } from './provider/officeViewerProvider';
import { ArchiveViewerProvider } from './provider/archiveViewerProvider';
import { ClassViewerProvider } from './provider/classViewerProvider';
import { JsonlViewerProvider } from './provider/jsonlViewerProvider';
import { HtmlService } from './service/htmlService';
import { MarkdownService } from './service/markdownService';
import { switchCsvEditor } from './service/csvService';
import { FileUtil } from './common/fileUtil';
import { ReactApp } from './common/reactApp';
import { activateHttp } from './provider/http';
import { activateYaml } from './provider/yaml';
import { activateXml } from './provider/xml';
import { activateGitHistory } from './gitHistory/provider';
import { IconService } from './service/icon/iconService';

export async function activate(context: vscode.ExtensionContext) {
	await Global.init(context);
	await IconService.getInstance().init(context);
	activateHttp(context);
	activateYaml(context);
	activateXml(context);
	// Awaited on purpose: the git-history commands are only registered at the end of
	// this call, so a fire-and-forget leaves a window where the extension is "active"
	// but `GaussAA.office.gitHistory.*` does not exist yet. That window is invisible
	// today (activation happens on startup) and becomes a real bug the moment activation
	// turns lazy. The integration smoke layer asserts the invariant.
	await activateGitHistory(context);
	const viewOption = customEditorOptions;
	FileUtil.init(context)
	ReactApp.init(context)
	const markdownService = new MarkdownService(context);
	const viewerInstance = new OfficeViewerProvider(context);
	const archiveViewerInstance = new ArchiveViewerProvider(context);
	const classViewerInstance = new ClassViewerProvider(context);
	const jsonlViewerInstance = new JsonlViewerProvider(context);
	const markdownEditorProvider = new MarkdownEditorProvider(context)
	context.subscriptions.push(
		vscode.commands.registerCommand('GaussAA.office.markdown.switch', (uri) => { markdownService.switchEditor(uri) }),
		vscode.commands.registerCommand('GaussAA.office.csv.switch', (uri) => { switchCsvEditor(uri) }),
		vscode.commands.registerCommand('GaussAA.office.markdown.paste', () => { markdownService.loadClipboardImage() }),
		vscode.commands.registerCommand('GaussAA.office.html.preview', uri => HtmlService.previewHtml(uri, context)),
		vscode.workspace.registerTextDocumentContentProvider('decompile_java', new JavaDecompilerProvider(context)),
		vscode.window.registerCustomEditorProvider("GaussAA.markdownViewer", markdownEditorProvider, viewOption),
		archiveViewerInstance.bindCustomEditor(viewOption),
		classViewerInstance.bindCustomEditor(viewOption),
		jsonlViewerInstance.bindCustomEditor(viewOption),
		...viewerInstance.bindCustomEditors(viewOption)
	);
}

export function deactivate() { }