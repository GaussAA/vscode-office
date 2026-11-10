import { theme as antdTheme } from "antd";
import { getVscodeThemeColor } from "../../util/vscodeTheme.ts";

/**
 * antd tokens derived from the same VS Code variables the stylesheet uses, so a theme switch
 * moves the antd islands (inputs, overlays) with the hand-written surface instead of against it.
 */
export function parquetAntdTheme(dark: boolean) {
  return {
    algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    token: {
      // A transparent container renders antd inputs as borders floating on the toolbar; the
      // table is flattened to the page in the stylesheet instead.
      colorBgContainer: getVscodeThemeColor(
        "--vscode-editor-background",
        dark ? "#1e1e1e" : "#ffffff",
      ),
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
      colorFillAlter: getVscodeThemeColor(
        "--vscode-editorGroupHeader-tabsBackground",
        dark ? "#2d2d2d" : "#f3f4f6",
      ),
      fontFamily: getVscodeThemeColor(
        "--vscode-font-family",
        '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      ),
      fontSize: Number.parseInt(getVscodeThemeColor("--vscode-font-size", "13px"), 10) || 13,
      controlHeightSM: 22,
      borderRadius: 4,
    },
  };
}
