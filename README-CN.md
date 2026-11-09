# Office Viewer Plus

[English](README.md) | 简体中文 | [繁體中文](README-TW.md)

## 介绍

这个扩展在 VS Code 里只预览**三样东西**：

| 格式                                                   | 你能得到什么                                          |
| ------------------------------------------------------ | ----------------------------------------------------- |
| 表格：`.xls`、`.xlsx`、`.xlsm`、`.csv`、`.tsv`、`.ods` | 可编辑并写回的网格，带查找/替换                       |
| Parquet：`.parquet`                                    | ZSTD/GZIP/BROTLI/LZ4 列、懒加载分页、全文件搜索，只读 |
| JSONL / NDJSON：`.jsonl`、`.ndjson`                    | 左侧条目目录，右侧把选中条目渲染成树或原文            |

就这些。这个 fork 从上游继承的其余格式——Word、PowerPoint、PDF、ePub、字体、图片、PSD、
ICNS、XMind、HTML、Java `.class`、压缩包——都在 **6.0.0** 里删掉了：其中一部分 VS Code
原生已经覆盖，其余的都有更成熟的专用阅读器。理由见
[ADR-0015](docs/adr/0015-narrow-to-three-viewers.md)，升级说明见 [CHANGELOG.md](CHANGELOG.md)。

## 本仓库：Office Viewer Plus（fork）

本仓库 fork 自 [cweijan/vscode-office](https://github.com/cweijan/vscode-office)（MIT，见
[NOTICE.md](NOTICE.md)），以 `GaussAA.office-viewer-plus` 发布，可与原版并存安装。这个 fork
只服务于一个人的数据工作，所以只保留那部分工作真正会用到的格式。

### Parquet：上游打不开的压缩文件

上游打包 `hyparquet` 时没有带解压器，ZSTD 压缩的 parquet 会直接报
`parquet unsupported compression codec: ZSTD`。本 fork 接入了 `hyparquet-compressors`，
SNAPPY / GZIP / BROTLI / ZSTD / LZ4 都能解码。

![ZSTD 压缩的 parquet](docs/screenshots/parquet-zstd.png)

读取是懒加载的，大文件也不会卡：

- **按页读取**：只解析当前可见的 50 行，377 MB 的文件不再把整张表读进内存。
- **支持时按 Range 取字节**：先用 2 字节探测，支持就只读 footer 和你看的页，否则退回一次性拉取；
  控制台会打印 `[parquet] source: ranged|full`。
- **百万行也能导航**：按行号跳转，页脚显示当前区间（`239,951–240,000 of 250,000`）。
- **按类型渲染**：数字右对齐 + 等宽数字，字符串/布尔/时间戳按主题着色，null 显示为 `NULL`，
  点击单元格可查看完整值。

![Parquet 类型着色](docs/screenshots/parquet-types.png)

工具栏的 **Find in file** 按 5000 行一批扫描全文件，带进度、标记命中行、在单元格内高亮匹配文本，
并自动跳到第一条命中。

查看器跟随 VS Code 主题——包括以前在深色视图下仍是浅色的 antd 控件。没有单独的明暗切换开关。

![浅色主题下的 parquet](docs/screenshots/parquet-light.png)

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

CI 在每次 push 时都会跑这两项，以及 `pnpm build` 和 `pnpm run package`。`pnpm verify:ui -- --docs`
可刷新上面的截图。

### 已知限制

- 超大文件的 parquet 全文件搜索受 I/O 限制（会读取访问到的每个 row group）。
- parquet 只读，没有写端。
- 表格超过 8 MB 时进入只读窗口视图（只渲染视口内的行）。工作簿超过 15 MB、虚拟工作区里的
  CSV/TSV 超过 25 MB 时先询问再加载；本地 CSV/TSV 最多可窗口化到 200 MB。工作簿以行文本
  窗口化，所以超过 8 MB 也是只读。
- JSONL 搜索匹配原始文本，不理解 JSON 路径。
- 上游的遥测已完全移除。

## Git 历史

扩展仍保留 Git 历史工作区（它是提交浏览器，不是文件预览，所以 6.0.0 的范围收窄没有动它）。
可从源代码管理视图、编辑器标题栏、编辑器右键菜单或文件资源管理器右键菜单打开。

![Git 历史](image/README/1783342874748.png)

## 其他功能

- YAML：文档大纲与锚点导航（别名引用可跳转到定义）
- XML：文档格式化
- 图标主题：8 个 [Material Icon Theme](https://github.com/PKief/vscode-material-icon-theme) 图标，覆盖表格、parquet 与 JSONL

## 开发

```bash
pnpm install
pnpm build        # 生产构建到 out/
pnpm run package  # 打 vsix（需先 build）
pnpm check        # 格式 + lint + 基线 + 类型 + 单测
pnpm check:full   # check + build + smoke + verify:ui
```

在 VS Code 里按 `F5`，选择 **Extension** 运行本地构建。

## 致谢

- 表格解析：[SheetJS/sheetjs](https://github.com/SheetJS/sheetjs)
- 表格渲染：[myliang/x-spreadsheet](https://github.com/myliang/x-spreadsheet)
- Parquet：[hyparquet](https://github.com/hyparam/hyparquet) 与
  [hyparquet-compressors](https://github.com/hyparam/hyparquet-compressors)
- 图标主题：[PKief/vscode-material-icon-theme](https://github.com/PKief/vscode-material-icon-theme)

## Sponsor

[![Database Client](https://doc.database-client.com/public/logo.png)](https://marketplace.visualstudio.com/items?itemName=cweijan.vscode-database-client2)

适用于 Visual Studio Code 的数据库客户端，支持 **MySQL/MariaDB、PostgreSQL、SQLite、Redis**
以及 **ElasticSearch**，也可作为 **SSH** 客户端使用。
[立刻安装](https://marketplace.visualstudio.com/items?itemName=cweijan.vscode-database-client2)。
