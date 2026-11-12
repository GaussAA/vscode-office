import { getVscodeThemeColor } from "../util/vscodeTheme.ts";

/**
 * antd tokens shared by the JSON preview and the JSONL viewer. Both surfaces use the same
 * compact chrome; keeping one palette prevents the two viewers from drifting apart when a VS
 * Code colour or a control size changes.
 */
export function jsonViewerThemeTokens(dark: boolean) {
  return {
    colorBgContainer: "transparent",
    colorBgElevated: getVscodeThemeColor(
      "--vscode-editorWidget-background",
      dark ? "#202020" : "#ffffff",
    ),
    colorBorder: getVscodeThemeColor("--vscode-panel-border", dark ? "#2b2b2b" : "#e5e5e5"),
    colorText: getVscodeThemeColor("--vscode-foreground", dark ? "#cccccc" : "#3b3b3b"),
    colorTextSecondary: getVscodeThemeColor(
      "--vscode-descriptionForeground",
      dark ? "#9d9d9d" : "#717171",
    ),
    colorPrimary: getVscodeThemeColor("--vscode-button-background", "#0078d4"),
    colorError: getVscodeThemeColor("--vscode-errorForeground", "#f14c4c"),
    colorWarning: getVscodeThemeColor("--vscode-editorWarning-foreground", "#cca700"),
    fontFamily: getVscodeThemeColor(
      "--vscode-font-family",
      '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    ),
    fontSize: Number.parseInt(getVscodeThemeColor("--vscode-font-size", "13px"), 10) || 13,
    controlHeightSM: 22,
    borderRadius: 4,
  };
}
