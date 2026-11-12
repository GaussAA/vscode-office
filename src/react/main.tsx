import "./polyfills/buffer";
import ReactDOM from "react-dom/client";
import "./util/vscode.js";
import { getConfigs } from "./util/vscodeConfig.ts";
import { initI18n } from "./i18n/i18nConfig.ts";
import "./main.css";
import { ConfigProvider } from "antd";
import { lazy } from "react";
import { antThemeConfig } from "./antThemeConfig.ts";
const Excel = lazy(() => import("./view/excel/Excel.tsx"));
const Parquet = lazy(() => import("./view/parquet/Parquet.tsx"));
const Jsonl = lazy(() => import("./view/jsonl/Jsonl.tsx"));
const JsonPreview = lazy(() => import("./view/json/JsonPreview.tsx"));
const Compare = lazy(() => import("./view/compare/Compare.tsx"));

const defaultStyles = document.getElementById("_defaultStyles");
if (defaultStyles?.parentNode) defaultStyles.parentNode.removeChild(defaultStyles);
const configs = getConfigs();
initI18n(configs?.language);

export default function App() {
  const route = configs?.route;
  switch (route) {
    case "excel":
      return <Excel />;
    case "parquet":
      return <Parquet />;
    case "jsonl":
      return <Jsonl />;
    case "json":
      return <JsonPreview />;
    case "compare":
      return <Compare />;
    default:
      return null;
  }
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <ConfigProvider componentSize="small" theme={antThemeConfig}>
    <App />
  </ConfigProvider>,
);
