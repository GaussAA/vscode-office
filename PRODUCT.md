# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**主要用户：维护者本人** —— 一个做数据处理的工程师，在 Windows 上的 VS Code 里打开自己管线产出的本地文件：
Hugging Face 数据集导出的 parquet（ZSTD 压缩、带 list 与 JSON 字符串字段）、JSONL/NDJSON 记录，以及
API/导出产出的 10–100 MB、minified 的 `.json` 顶层数组。他要回答的问题很具体：这份文件有哪些列、某个值到底
是什么类型、某个字符串在哪一行、文件有多大。做这件事时他不想写脚本，也不想离开编辑器。

**次要用户：少量外部 VS Code 用户**（interview 确认）。他们的入口是 GitHub（issue、Release 里的 VSIX），
不是扩展市场。因此：手感按行家调，但**关键交互、空状态与错误文案必须能被第一次用的人看懂**；README 与
Release 说明保持对外可读。

## Product Purpose

一个 VS Code 扩展，只预览两件事——parquet 与 JSONL/NDJSON——并且能打开上游打不开的那些文件。另有一个
命令式只读 JSON 检查器：它不注册 `.json`、不接管默认编辑器，只服务原生文本编辑器不擅长的 10–100 MB /
minified 顶层数组。

它存在的原因是两个具体的缺口：上游的 parquet 视图不挂 decompressor，ZSTD 文件直接报
`parquet unsupported compression codec: ZSTD`；而「一行一个 JSON」不是表格，硬塞进网格就丢了结构。
成功的样子是：这两类文件双击就开、在真实体积下照样能用、不需要另开一个独立应用。

## Positioning

相邻选择无法诚实复制的一点：**它是「上游那个 VS Code 预览 + 全部 codec + 懒读」的组合，而不是三者之一。**

- 上游的 parquet 预览（同一个扩展、同一套 webview）在 ZSTD 上直接失败——它引用 `hyparquet` 却不加载
  `hyparquet-compressors`。
- 专门的 parquet 桌面工具能开，但它们是另一个应用，呆在编辑器之外。
- 通用数据插件覆盖面更广，但不会为一个 377 MB、1M 行、60 列的文件只解码当前 50 行。

本仓库是把这个组合做到位的那一个，并且用「只保留两种格式」换取每一种都做完整。7.0.0 删掉了表格
（`.xls/.xlsx/.xlsm/.csv/.tsv/.ods` 的可编辑预览，ADR-0029）：`.csv/.tsv` 回到 VS Code 自己的文本编辑器，
`.xlsx` 系列交给 Office/WPS，本扩展不再维护第二份解析器、渲染器与保存通道。

## Operating Context

- **宿主只有 VS Code desktop**。`engines.vscode` 下限 `^1.125.0`，用 `pnpm test:smoke:min` 在下限上真跑一遍；
  web extension host 已放弃（ADR-0008）。
- **文件是本地文件**；parquet 与 JSONL 都按窗口读，JSON 预览整份读入内存后扫描记录边界。
- **真实体积是常态，不是压力测试**：377 MB parquet、1M 行、60 列；1M 行 JSONL；91.6 MB 的 JSON 顶层数组。
  任何「小文件能跑」的实现都不算完成。
- **验收靠机器看，不靠眼睛看**：单元测试（纯逻辑）、真实 VS Code 里的激活与路由 smoke、无头浏览器的
  DOM 断言 + 截图 + 交互帧间隔、大文件字节数与耗时预算。四层各管一件事，互不替代。
- **发版节奏**：积累若干改进后**一次性发布**，不为单个改动单独发版；发布物是 GitHub Release 上的 VSIX，
  tag 与打包版本号由 `check:release` 对齐。
- **语言**：界面文案英文，宿主侧字符串走 `l10n`（现有 9 个语言 bundle）；README 有英 / 简中 / 繁中三份；
  仓库内部文档（ADR、GLOSSARY、AGENTS）是中文。

## Capabilities and Constraints

**已确认能力（两个 viewer + 一个命令，且都被闸门看守）**

- parquet：SNAPPY/GZIP/BROTLI/ZSTD/LZ4 全解；一次一页；2 字节探针决定 ranged 还是整份读取；按行号跳转；
  类型感知单元格（数字右对齐、时间戳按主题着色、`BYTE_ARRAY` 显十六进制、空值显示 `NULL`）；列表与 JSON
  字符串按 token 着色；整值是 `http(s)` 的单元格是链接；点 schema 字段横向跳到该列；schema 侧栏按列给出
  空值率（读 row-group statistics，不解码列；未写统计、部分行组、嵌套列三种状态各自明说），点开字段行
  （或按 `i`）看该列的 top-N 与基数——扫描只解这一列、默认前 20 万行，并标明覆盖范围。这两层都由宿主侧
  接缝回答（ADR-0020）。
- JSONL：左目录右详情；字节留在宿主，webview 只拿摘要加当前一条；全文件搜索按批流式返回并带上下文。
  目录优先显示身份标签（顶层身份键；该键是对象时再读一层）；摘要只有一个数 `SUMMARY_CHARS = 120`（建树、
  详情头、Raw 默认、目录标签与搜索片段同一口径，超出补 `… (N chars)`），没有 wrap 模式，所有条目固定
  行高虚拟列表；选中值在树的下沿停靠值面板里读全文——按行虚拟化、预算 4,000,000 字符、可展开铺满右栏、
  复制始终是整值；`invalid` / `too-large` 的错误原文也走这个面板。单行解析上限 8 MB；原文上限 1,000,000
  字符（明确标出截断）；目录窗口按 4 MB 预算加载，填不满一屏时末尾留一行显式 Load more。
- 全文件搜索：parquet 1M 行约 1.3 s、JSONL 20 万行 0.3–0.5 s，都是被性能闸门守住的不变量。
- 对比：命令式（Comparison preview，ADR-0021）打开两个 parquet，一张表按列给左右两侧的空值率、区间与
  差异，分组为新增/消失/类型变化/变化/无法比较/相同；只读两边 footer、不解码任何一列；行数差是结论而
  不是错误；带「只看有变化的列」开关。

**命令式只读检查器（不进入 Viewer 格式集合）**

- JSON：命令面板、资源管理器右键和 JSON 编辑器标题三处入口打开一个只读 webview 面板；不写
  `contributes.customEditors`、不注册 `.json`、不改默认编辑器。左侧虚拟记录列表（`[index]` + 身份标签，
  无身份时回退原始 JSON 头），右侧选中记录的树与底部值面板；沿用 JSONL 的 Splitter、树、值面板与键盘，
  左栏宽度可拖并记住。顶层数组按记录流式索引，10–100 MB 不整份 parse；对象根上限 20 MB；全文件记录级
  搜索（数组根按记录，对象根按路径），结果列表带片段与命中数，选中记录后树展开并高亮首个命中；严格 JSON，
  注释/尾逗号给解析错误与文本编辑器出口；编辑器有未保存修改时读 buffer 并标明。超过 100 MB 的数组或
  20 MB 的对象根显示 too-large，并在文本编辑器中打开。摘要与值面板契约与 JSONL 相同（ADR-0030）。

**硬约束**

- **全部预览面只读**：parquet、JSONL 与 JSON 预览都不写回文件；没有保存路径、没有编辑态、没有脏标记
  （GLOSSARY: Read-only preview）。只读不是「缺功能」，是另一种承诺。
- **格式集合已关闭**（interview 确认）：两个 Viewer 的格式与默认接管是上限，不会新增第三种 viewer；
  7.0.0 删掉表格是反向操作，不构成「新增格式」的判据。JSON 只作为命令式只读检查器存在：不写
  `contributes.customEditors`、不注册 `.json`、不改 `.json` 的默认编辑器、不编辑、不校验 schema、
  不支持 JSONC。
- **下一步方向**：交互与无障碍（ADR-0023）——先给 parquet 加可听反馈（翻页/搜索/选中的 live region），
  再把动效令牌扩到 JSONL 与 JSON。它**尚未实现**，不得写进上面的能力清单。
- **身份独立、可与上游共存**：`GaussAA.office-viewer-plus`，不覆盖 `cweijan.vscode-office`；上游是只读
  参考资料，不 merge、不 rebase（ADR-0002）。
- **严格跟随 VS Code 主题**，包括 antd 组件；没有自带的明暗开关。
- **零遥测**；上游的 telemetry 已被整体移除。
- **webview 里的东西一律不可信**：字节、URL、文件系统读取都留在扩展宿主。外部链接只有一个判据函数
  `normalizeExternalUrl`（只认完整 `http(s)`、拒绝 userinfo 与控制字符、限长 2048），webview 用它决定
  显示，宿主在 `vscode.env.openExternal` 之前再验一次。
- **闸门 fail-closed**：typecheck 基线已清空，任何类型错误都会让构建失败；UI 验收断言主题感知对比度
  ≥ 4.5:1；性能预算按 `pnpm verify:perf`，交互帧预算按 `verify:ui` 的帧场景。
- **发布**：当前版本与发布记录见 `package.json`、`CHANGELOG.md` 与 `docs/agents/release.md`；7.0.0 起
  产品名是 `Data File Viewer (Parquet, JSONL)`。

## Brand Commitments

- **名字**：Data File Viewer (Parquet, JSONL)（Marketplace 显示名，全仓库统一；曾用名 "Office Viewer Plus"
  在 Marketplace 上被拒为已占用；6.4.5–6.x 的显示名带 Excel，7.0.0 起去掉）。发布者 `GaussAA`；扩展 id
  `GaussAA.office-viewer-plus`。JSON 预览是命令式检查器，不进入显示名。
- **署名与许可**：MIT，fork 自 `cweijan/vscode-office`（固定来源 `forkedFrom: cweijan.vscode-office@4.2.2`），
  `NOTICE.md` 记录来源。
- **语气**：具体、机制优先、不自夸。README 先说清楚上游哪里坏、我们改了什么机制，并且**主动列出
  Non-goals 与 Known gaps**，而不是省略它们。
- **证据形态**：`docs/screenshots/` 下的截图即对外证据，由 `pnpm verify:ui --docs` 从真实 webview 重新生成，
  不手工修图。

## Evidence on Hand

- `docs/screenshots/*.png` —— 三份 README 引用的真实渲染截图（ZSTD、类型、浅色主题、JSONL 两栏、JSON
  记录/搜索、值面板）。
- `scripts/ui-verify/` —— 无头浏览器场景与 fixture（含构造的 parquet/JSONL 文件）；断言 DOM 与交互帧间隔。
- `scripts/perf/` —— 字节数与耗时预算；大文件缓存在本地。
- `test/unit/`、`test/smoke/` —— 纯逻辑与真实宿主两层。
- `docs/adr/0001`–`0030`、`GLOSSARY.md`、`CHANGELOG.md` —— 决策、术语与逐版说明。
- **没有的**（未来工作不得编造）：用户评价、安装量、Marketplace 评分、外部基准对比、用户研究、付费/商业
  承诺；以及未经闸门与截图验证的能力（本文件只记录证据在手的东西）。

## Product Principles

1. **体积是需求本身。** 一个只在示例文件上好看的预览不算做完；每个 viewer 都要在维护者真实打开的体量上
   验证过。
2. **能力边界要明说。** 只读就说只读、没写就说没写——Non-goals 与 ADR 里的「不做」、Known gaps 里的
   「还没做到」，与做出来的功能同等重要。
3. **用机器判断，而不是用眼睛判断。** UI 改动靠 DOM 断言 + 字节/耗时/帧预算决定去留，截图只是记录结果。
4. **边界上收，内部放开。** 跨到宿主之外的东西（文件字节、外部链接、系统调用）都必须经过一个可测试的
   收口点；收口之后的内部实现可以大胆。
5. **窄而完整 > 宽而将就。** 两种格式，每种做到底；多出来的格式不是能力，是维护债。命令式检查器可以存在，
   但它不扩大 Viewer 的格式集合，同样要窄而完整。

## Accessibility & Inclusion

- **关键路径必须全键盘可达**（interview 确认的硬要求）：新增交互必须同时给出键盘路径与可见焦点。现有实现：
  JSONL 的 `←`/`→` 展开与收起、`Space` 切换、`Enter` 打开或收起值面板、`Ctrl+C` 复制值、
  `Ctrl+Shift+C` 复制路径、`Esc` 收起值面板；链接单元格 `Enter`/`Space` 打开，按钮式列表项带
  `aria-pressed` 与 `:focus-visible`。JSON 预览复用同一组键：记录列表 `↑`/`↓` 选择、`Enter` 打开记录、
  `←`/`→`/`Space` 收展、`Enter` 切值面板、`Ctrl+C` / `Ctrl+Shift+C`、`Esc` 清搜索或收面板；命令面板、
  资源管理器右键与编辑器标题入口都可用键盘到达。表格删除后，JSONL 的值面板多了一个「展开读」按钮，
  它必须按 Tab 可达。
- **对比度**：UI 验收按主题断言链接色与 JSON token 色 ≥ 4.5:1，不得为了好看放宽。
- **未承诺**：没有成文的 WCAG 等级目标，也没有做过屏幕阅读器验证——不要对外声称达标。
