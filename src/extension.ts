import * as vscode from "vscode";
import { customEditorOptions } from "@/common/customEditorOptions";
import { Global } from "./common/global";
import { OfficeViewerProvider } from "./provider/officeViewerProvider";
import { JsonlViewerProvider } from "./provider/jsonlViewerProvider";
import { activateJsonPreview } from "./provider/jsonPreview";
import { activateCompare } from "./provider/comparePanel";
import { switchCsvEditor } from "./service/csvService";
import { FileUtil } from "./common/fileUtil";
import { ReactApp } from "./common/reactApp";
import { activateYaml } from "./provider/yaml";
import { activateXml } from "./provider/xml";
import { IconService } from "./service/icon/iconService";

export async function activate(context: vscode.ExtensionContext) {
  await Global.init(context);
  await IconService.getInstance().init(context);
  activateYaml(context);
  activateXml(context);
  const viewOption = customEditorOptions;
  FileUtil.init(context);
  ReactApp.init(context);
  activateJsonPreview(context);
  activateCompare(context);
  const viewerInstance = new OfficeViewerProvider(context);
  const jsonlViewerInstance = new JsonlViewerProvider(context);
  context.subscriptions.push(
    vscode.commands.registerCommand("GaussAA.office.csv.switch", (uri) => {
      switchCsvEditor(uri);
    }),
    jsonlViewerInstance.bindCustomEditor(viewOption),
    ...viewerInstance.bindCustomEditors(viewOption),
  );
}

export function deactivate() {}
