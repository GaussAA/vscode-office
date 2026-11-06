# Office Viewer

[English](README.md) | 简体中文 | [繁體中文](README-TW.md)

## 介绍

本扩展支持在 VS Code 中预览以下常见的办公文件格式：

- Excel: `.xls`、`.xlsx`、`.xlsm`、`.csv`、`.ods`
- Word: `.docx`、`.dotx`
- PowerPoint: `.pptx`、`.pptm`
- PDF 与电子书: `.pdf`、`.epub`
- HEIC/TIFF: `.heic`、`.heif`、`.tiff`
- 设计文件: `.psd`、`.xmind`、`.icns`、`.svg`
- 字体: `.ttf`、`.otf`、`.woff`、`.woff2`
- Markdown: `.md`、`.markdown`
- HTML: `.html`、`.htm`
- Java: `.class`（反编译）
- 压缩文件: `.zip`、`.jar`、`.vsix`、`.rar`、`.7z`、`.tar`、`.tar.gz`、`.tgz`、`.apk`

## 本仓库：Office Viewer Plus（fork）

本仓库 fork 自 [cweijan/vscode-office](https://github.com/cweijan/vscode-office)（MIT，见
[NOTICE.md](NOTICE.md)），以 `GaussAA.office-viewer-plus` 发布，可与原版并存安装。上面的功能
全部保留，此外还增加了：

### Parquet：上游打不开的压缩文件

上游打包 `hyparquet` 时没有带解压器，ZSTD 压缩的 parquet 会直接报
`parquet unsupported compression codec: ZSTD`。本 fork 接入了 `hyparquet-compressors`，
SNAPPY / GZIP / BROTLI / ZSTD / LZ4 都能解码。

![ZSTD 压缩的 parquet](docs/screenshots/parquet-zstd.png)

读取是懒加载的，大文件也不会卡：

- **按页读取**：只解析当前可见的 50 行，377 MB 的文件不再把整张表读进内存；
  编辑按"绝对行号 → 补丁"记录，翻页时重新叠加。
- **支持时按 Range 取字节**：先用 2 字节探测，支持就只读 footer 和你看的页，否则退回一次性拉取；
  控制台会打印 `[parquet] source: ranged|full`。
- **超大文件自动只读**：保存需要全量重读，所以超过 20 万行时直接禁用编辑并说明原因。
- **百万行也能导航**：按行号跳转，页脚显示当前区间（`239,951–240,000 of 250,000`）。
- **按类型渲染**：数字右对齐 + 等宽数字，字符串/布尔/时间戳按主题着色，null 显示为 `NULL`，
  编辑过的单元格有标记，点击单元格可查看完整值。

![Parquet 类型着色](docs/screenshots/parquet-types.png)

工具栏的 **Find in file** 按 5000 行一批扫描全文件，带进度、标记命中行、在单元格内高亮匹配文本，
并自动跳到第一条命中。

### JSONL / NDJSON：目录 + 树，而不是表格

一行一个 JSON 值不适合表格，因此提供双栏视图：左侧列出条目，右侧把选中条目渲染成树（或原文）。

![JSONL 双栏视图](docs/screenshots/jsonl-two-pane.png)

- **文件字节不进 webview**：webview 只拿到可见条目的摘要和选中条目的完整值。
- **全文件搜索**：分批流式返回，命中处带上下文片段并高亮。
- **长值换行**而不是截断；节点数超过 500 的条目自动退回固定行高虚拟列表，避免极端行卡死界面。
- 键盘：`←`/`→` 折叠展开，`Space` 切换，`Enter` 复制值，`Ctrl+Shift+C` 复制路径。

### 验收方式

```bash
pnpm test        # 解析逻辑单测（node:test，不引入额外框架）
pnpm verify:ui   # 无头浏览器 DOM 断言；截图输出到 .ui-verify/shots
```

CI 在每次 push 时都会跑这两项，以及 `pnpm build` 和 `pnpm run package`。`verify:ui -- --docs`
可刷新上面的截图。设计取舍见 [docs/adr/0001-fork-office-viewer.md](docs/adr/0001-fork-office-viewer.md)。

### 已知限制

- 保存非 SNAPPY 的 parquet 会被重写成 SNAPPY（写端只支持它），保存前会提示。
- 超过 20 万行的 parquet 只读；超大文件的全文件搜索受 I/O 限制（会读取访问到的每个 row group）。
- JSONL 搜索匹配原始文本，不理解 JSON 路径。
- 上游的遥测已完全移除。

## Git 历史

Office Viewer 内置完整的 Git 历史工作区，让你无需离开 VS Code 即可浏览仓库。可从源代码管理视图、编辑器标题栏、编辑器右键菜单或文件资源管理器右键菜单打开。

![1783342874748](image/README/1783342874748.png)

## Markdown

集成 Markdown 所见即所得编辑器。

如需使用 VS Code 原生 Markdown 编辑器，请在 `settings.json` 中添加以下配置：

```json
{
  "workbench.editorAssociations": {
    "*.md": "default",
    "*.markdown": "default"
  }
}
```

在编辑器中右键，可将 Markdown 导出为 PDF、DOCX 或 HTML。PDF 导出依赖 Chromium，可通过 `vscode-office.chromiumPath` 配置浏览器路径。

![导出 Markdown](image/README-CN/1685418034035.png)

快捷键：基于 [shortcut.md](shortcut.md)，以及：

- 新行: `Ctrl+Enter` / `⌘ Enter`
- 硬换行: `Shift+Enter` / `⇧ Enter`
- 编辑超链接: `Alt+Enter` / `^ Enter`
- 设置 CodeMirror 语言: `Alt+Enter` / `^ Enter`
- 在 VS Code 中编辑: `Ctrl Alt E` / `⌘ ^ E`
- 粘贴为纯文本: `Ctrl+Shift+V` / `⌘ ⇧ V`

## 其他功能

- HTML: 编辑时按下 `Ctrl+Shift+V` 可实时预览
- YAML: 支持文档大纲与锚点导航（别名引用可跳转到定义）
- 图标主题: 26 个 [Material Icon Theme](https://github.com/PKief/vscode-material-icon-theme) 图标。两个配色主题与五套额外语法主题已在 5.0.0 移除，见 [CHANGELOG.md](CHANGELOG.md)
- Excel: 支持预览和保存 `.xlsx`、`.xls`、`.xlsm`、`.csv`、`.ods` 等文件
- Java: 打开 `.class` 文件可反编译并查看源码

## Sponsor

[![Database Client](https://doc.database-client.com/public/logo.png)](https://marketplace.visualstudio.com/items?itemName=cweijan.vscode-database-client2)

适用于 Visual Studio Code 的数据库客户端，支持 **MySQL/MariaDB、PostgreSQL、SQLite、Redis** 以及 **ElasticSearch** 等数据库的管理，且可作为一个 SSH 客户端，极大地提升您的生产力！[立刻安装](https://marketplace.visualstudio.com/items?itemName=cweijan.vscode-database-client2)。

## 开发指南

### 环境要求

- [Node.js](https://nodejs.org/) 24+（VS Code 1.125 的宿主运行时）
- [VS Code](https://code.visualstudio.com/) 1.125+

### 快速开始

```bash
git clone https://github.com/cweijan/vscode-office.git
cd vscode-office
npm install
```

### 开发调试

**桌面端扩展**（完整功能）：

```bash
npm run dev
```

在 VS Code 中按 `F5`，或在「运行和调试」中选择 **Extension**。

**Web 端扩展**（浏览器中的 Markdown、HTML、YAML）：

```bash
npm run dev:web
```

在「运行和调试」中选择 **Extension (Web)**。

### 构建与打包

```bash
npm run build    # 生产构建
npm run package  # 生成 .vsix
```

## 使用数据（Usage Data）

Office Viewer 会收集**匿名使用数据**，用于了解各预览功能的使用情况，以便改进扩展。数据通过官方模块 [`@vscode/extension-telemetry`](https://www.npmjs.com/package/@vscode/extension-telemetry) 发送至 [Azure Application Insights](https://learn.microsoft.com/zh-cn/azure/azure-monitor/app/app-insights-overview)。

### 收集内容

| 事件        | 触发时机              | 属性                                                                                 |
| ----------- | --------------------- | ------------------------------------------------------------------------------------ |
| `view.open` | 打开自定义预览/编辑器 | `viewType`（如 `excel`、`markdown`、`pdf`）、`fileType`（仅扩展名，如 `xlsx`、`md`） |

**不会**收集文件路径、文件名、URL、仓库名、请求内容或其他可识别个人身份的信息。

### 如何关闭

仅在以下**两项均允许**时才会上报：

1. VS Code 全局遥测已开启（`telemetry.telemetryLevel` 不为 `off`，或旧版中 `telemetry.enableTelemetry` 为 `true`）。
2. 扩展遥测已开启：在设置中将 `vscode-office.enableTelemetry` 设为 `false` 可单独关闭本扩展的上报。

也可在 **设置 → 应用程序 → 遥测** 中关闭 VS Code 的全部遥测。

### 维护者配置

若自行构建并发布本扩展，请参阅 [docs/telemetry.md](docs/telemetry.md) 配置 Azure Application Insights 及示例查询。

## Credits

- PDF rendering: [mozilla/pdf.js](https://github.com/mozilla/pdf.js/)
- DOCX rendering: [VolodymyrBaydalka/docxjs](https://github.com/VolodymyrBaydalka/docxjs)
- PPTX rendering: [pptxviewjs](https://www.npmjs.com/package/pptxviewjs)
- XLSX rendering:
  - [SheetJS/sheetjs](https://github.com/SheetJS/sheetjs): XLSX parsing
  - [myliang/x-spreadsheet](https://github.com/myliang/x-spreadsheet): XLSX rendering
- EPUB: [futurepress/epub.js](https://github.com/futurepress/epub.js)
- PSD: [ag-psd](https://github.com/Agamnentzar/ag-psd)
- XMind: [mind-elixir](https://github.com/ssshooter/mind-elixir-core), [@mind-elixir/import-xmind](https://github.com/ssshooter/mind-elixir-core)
- HEIC conversion: [heic2any](https://github.com/alexcorvi/heic2any)
- Java decompiler: [JetBrains/java-decompiler](https://github.com/JetBrains/intellij-community/tree/master/plugins/java-decompiler/engine)
- HTTP: [REST Client](https://github.com/Huachao/vscode-restclient)
- Markdown: [Vanessa219/vditor](https://github.com/Vanessa219/vditor)
- Material Icon theme: [PKief/vscode-material-icon-theme](https://github.com/PKief/vscode-material-icon-theme)
