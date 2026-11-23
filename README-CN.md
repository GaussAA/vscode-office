# Data File Viewer (Parquet, JSONL)

[English](README.md) | 简体中文 | [繁體中文](README-TW.md)

## 介绍

这个扩展在 VS Code 里只预览**两样东西**：

| 格式                                | 你能得到什么                                          |
| ----------------------------------- | ----------------------------------------------------- |
| Parquet：`.parquet`                 | ZSTD/GZIP/BROTLI/LZ4 列、懒加载分页、全文件搜索，只读 |
| JSONL / NDJSON：`.jsonl`、`.ndjson` | 左侧条目目录，右侧把选中条目渲染成树或原文            |

就这些。这个 fork 从上游继承的其余格式——Word、PowerPoint、PDF、ePub、字体、图片、PSD、
ICNS、XMind、HTML、Java `.class`、压缩包——都在 **6.0.0** 里删掉了
（[ADR-0015](docs/adr/0015-narrow-to-three-viewers.md)）。可编辑的表格预览
（`.xls`、`.xlsx`、`.xlsm`、`.csv`、`.tsv`、`.ods`）在 **7.0.0** 删除
（[ADR-0029](docs/adr/0029-narrow-to-two-viewers.md)）：`.csv`/`.tsv` 回到 VS Code 自己的文本编辑器，
工作簿格式交给 Office/WPS，本扩展不再维护第二份解析器。

除此之外还有一个命令式打开的只读 JSON 检查器，用来读大的 `.json` 顶层数组；它不注册
`.json`、不改变默认编辑器，见下面的 [JSON 数组](#json-数组不打开文本编辑器也能读)。

## 本仓库：Data File Viewer (Parquet, JSONL)（fork）

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
- **按类型渲染**：数字右对齐 + 等宽数字，字符串/布尔/时间戳按主题着色，普通 `BYTE_ARRAY`
  以十六进制显示，null 显示为 `NULL`，点击单元格可查看完整值。
- **结构化单元格有结构感**：JSON 数组/对象（包括 Polars 存成 JSON 字符串的 list 字段）
  会按语法着色，而不是糊成一段字符串。
- **URL 可直接点击**：整个值都是 `http(s)` URL 的单元格会通过扩展宿主在浏览器打开；
  其他协议、带账号密码的 URL 不会被打开。
- **点击左侧字段跳到对应列**：表格水平滚动到该列并留下淡色高亮，不改变行、分页或筛选。
- **侧栏给每列一个画像**：每个字段显示空值占比，读的是 row-group statistics（footer 元数据，
  不解码任何一列）。writer 没写统计时明说而不是显示 `0%`，只有部分行组带统计时标为 partial，
  嵌套列不做画像——叶子统计不是一行的值。点徽标（或字段行聚焦时按 `i`）看这一列的 top-N 与
  次数：扫描只解这一列，最多 20 万行，面板会写明扫了多少。

![Parquet 类型着色](docs/screenshots/parquet-types.png)

工具栏的 **Find in file** 每列只扫描一遍全文件，带进度、标记命中行、在单元格内高亮匹配文本，
并自动跳到第一条命中；100 万行约 1.3 秒。

查看器跟随 VS Code 主题——包括以前在深色视图下仍是浅色的 antd 控件。没有单独的明暗切换开关。

![浅色主题下的 parquet](docs/screenshots/parquet-light.png)

![列画像](docs/screenshots/parquet-profile.png)

### 对比两个 parquet 文件

两个文件，一张表。命令里先后选左右两个文件，面板按列给出**两侧**的空值率与区间，并按结果分组：
新增、消失、类型变化、变化、无法比较、相同。它只读两边的 footer——不解码任何一列、不比较任何
一行，所以 377 MB × 2 也是点开就有。

行数差是头部的一条结论，不是错误；某一侧没写统计时显示「无法比较」，而不是假装没有变化。

![对比两个 parquet 文件](docs/screenshots/parquet-compare.png)

### JSONL / NDJSON：目录 + 树，而不是表格

一行一个 JSON 值不适合表格，因此提供双栏视图：左侧列出条目，右侧把选中条目渲染成树（或原文）。

![JSONL 双栏视图](docs/screenshots/jsonl-two-pane.png)

- **文件字节不进 webview**：webview 只拿到可见条目的摘要和选中条目的完整值。
- **全文件搜索**：分批流式返回，命中处带上下文片段并高亮；长值里的命中在树里也看得见——
  摘要以首个命中为中心，而不是永远从第 0 个字符开始截。
- **目录读身份，不只看原始开头**：条目有顶层身份键时显示它；身份键是对象时再往里读一层
  （如 `id: { query }`）。
- **摘要只有一个数：120 字符。** 树行、详情头、Raw 标签、目录标签与搜索片段都读同一个常量，
  超出补 `… (N chars)`。没有换行模式；所有条目都走固定行高的虚拟列表，再长的行也卡不死界面。
- **值面板是唯一的全文通道。** 选中一个值后，树下方展开停靠面板，给全文、路径、类型与字符数；
  正文按行渲染、最多显示 4,000,000 字符、可展开铺满右栏，`Copy value` 永远是整值。解析不了的
  （`invalid`）或超过 8 MB 解析上限的（`too-large`）行，原文也在同一个面板里读，而不是铺满正文。
- **上限会说出来。** 单行超过 8 MB 时按原始文本显示而不解析成树；原文最多 1,000,000 字符并明确
  标出截断；树的 20,000 节点上限也有提示行，而不是无声结束。
- 键盘：`←`/`→` 折叠展开，`Space` 切换，`Enter` 打开或收起值面板，`Ctrl+C` 复制值，
  `Ctrl+Shift+C` 复制路径，`Esc` 收起面板。

![JSONL 值面板](docs/screenshots/jsonl-value-panel.png)

### JSON 数组：不打开文本编辑器也能读

只读检查器，面向顶层是数组或对象的 `.json` 文件。它是命令，不是 viewer：不注册
`.json`、不接管默认编辑器、不写 `contributes.customEditors`。入口是命令面板
（**Data File Viewer: Preview JSON**）、资源管理器右键和 JSON 编辑器标题。

![JSON 预览](docs/screenshots/json-records.png)

- **大数组只建索引，不整份 parse。** 顶层数组最多 100 MB，按记录边界流式扫描；webview 只为可见行要
  `[index]` 标签，并一次只要一条记录。对象根（最多 20 MB）整份解析。
- **先找记录，再找键。** 全文件搜索返回命中的记录、片段与命中数；选中后加载该记录，展开并高亮第一个
  命中的键；对象根的结果是路径。
- **只接受严格 JSON。** 注释和尾逗号会给出带行列的解析错误，并留一个 **Open in Text Editor** 出口；
  编辑器有未保存修改时优先读 buffer，并在工具栏标明。
- **只读是承诺。** 没有编辑、schema 校验或 JSONC；所有动作最终都回到文本编辑器。
- **摘要与值面板和 JSONL 同源**：120 字符摘要、停靠值面板作为唯一全文通道（最多 4,000,000 字符）、
  命中居中的摘要。
- 键盘：记录列表 `↑`/`↓`/`Home`/`End`；树 `←`/`→`/`Space` 收展、`Enter` 切值面板、
  `Ctrl+C` / `Ctrl+Shift+C` 复制值/路径、`Esc` 清搜索或收面板。

![JSON 搜索结果](docs/screenshots/json-search.png)

上限：100 MB 数组、20 MB 对象根、单条记录 8 MB（超过按原文显示）、每条原文最多 1,000,000 字符、
值面板最多 4,000,000 字符、每次搜索最多 10,000 个命中。记录列表是虚拟列表；树复用 JSONL 的
20,000 节点/每层 200 子项/12 层上限。

### 验收方式

```bash
pnpm test        # 解析逻辑单测（node:test，不引入额外框架）
pnpm verify:ui   # 无头浏览器 DOM 断言 + 交互帧间隔；截图输出到 .ui-verify/shots
pnpm verify:perf # 大文件首屏字节数/耗时与搜索耗时闸门
```

CI 在每次 push 时都会跑这三项，以及 `pnpm build` 和 `pnpm run package`。`pnpm verify:ui --docs`
可刷新上面的截图。

### 非目标

- parquet 只读，没有写端。
- JSONL 搜索匹配原始文本，不理解 JSON 路径。
- 不做表格/Office 预览：`.xls`、`.xlsx`、`.xlsm`、`.ods`、`.csv`、`.tsv` 都不再由此扩展打开
  （CSV/TSV 回落到 VS Code 文本编辑器）。

### 已知缺口

- 超大文件的 parquet 全文件搜索受 I/O 限制（会读取访问到的每个 row group）。
- JSONL 单行超过 8 MB 时只按原始文本显示、不解析成树；原文上限 1,000,000 字符（并明确提示），
  不会假装那是全文。
- JSONL 的树有上限：20,000 个节点、每层 200 个子项、12 层。截断时树会说出来；剩下的内容用值面板读。
- 目录窗口按字节（4 MB）而不是行数封顶：由超大行组成的文件只在选中处附近列出少量条目，
  不会为了填满一屏先解析整块。用条目编号跳转；窗口只会向下追加，填不满一屏时末尾有一行
  显式的“加载更多条目”。
- JSON 预览的数组上限 100 MB、对象根上限 20 MB；单条记录超过 8 MB 按原文显示，值面板上限
  4,000,000 字符，搜索最多 10,000 个命中，JSONC/尾逗号会被拒绝。它是命令式面板，窗口重载后不恢复
  上一次预览的文档，需要重新执行命令。
- 表格完全不预览：`.xlsx/.xlsm/.xls/.ods` 在 VS Code 里没有回落路径，`.csv/.tsv` 以纯文本打开。

上游的遥测已完全移除。

#### 其他功能

- YAML：文档大纲与锚点导航（别名引用可跳转到定义）
- XML：文档格式化
- 图标主题：8 个 [Material Icon Theme](https://github.com/PKief/vscode-material-icon-theme) 图标，
  覆盖表格、parquet 与 JSONL 文件（表格预览删掉后，这些图标仍用于在资源管理器里认出文件）

## 开发

```bash
pnpm install
pnpm build        # 生产构建到 out/
pnpm run package  # 打 vsix（需先 build）
pnpm check        # 格式 + lint + 基线 + 类型 + 单测
pnpm check:full   # check + build + smoke + verify:ui + verify:perf
```

在 VS Code 里按 `F5`，选择 **Extension** 运行本地构建。

## 致谢

- Parquet：[hyparquet](https://github.com/hyparam/hyparquet) 与
  [hyparquet-compressors](https://github.com/hyparam/hyparquet-compressors)
- 图标主题：[PKief/vscode-material-icon-theme](https://github.com/PKief/vscode-material-icon-theme)

## Sponsor

[![Database Client](https://doc.database-client.com/public/logo.png)](https://marketplace.visualstudio.com/items?itemName=cweijan.vscode-database-client2)

适用于 Visual Studio Code 的数据库客户端，支持 **MySQL/MariaDB、PostgreSQL、SQLite、Redis**
以及 **ElasticSearch**，也可作为 **SSH** 客户端使用。
[立刻安装](https://marketplace.visualstudio.com/items?itemName=cweijan.vscode-database-client2)。
