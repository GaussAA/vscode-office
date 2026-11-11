# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**主要用户：维护者本人** —— 一个做数据处理的工程师，在 Windows 上的 VS Code 里打开自己管线产出的本地文件：Hugging Face 数据集导出的 parquet（ZSTD 压缩、带 list 与 JSON 字符串字段）、JSONL/NDJSON 记录、以及各种表格。他要回答的问题很具体：这份文件有哪些列、某个值到底是什么类型、某个字符串在哪一行、文件有多大。做这件事时他不想写脚本，也不想离开编辑器。

**次要用户：少量外部 VS Code 用户**（interview 确认）。他们的入口是 GitHub（issue、Release 里的 VSIX），不是扩展市场。因此：手感按行家调，但**关键交互、空状态与错误文案必须能被第一次用的人看懂**；README 与 Release 说明保持对外可读。

## Product Purpose

一个 VS Code 扩展，只预览三件事——表格（xls/xlsx/xlsm/csv/tsv/ods）、parquet、JSONL/NDJSON——并且能打开上游打不开的那些文件。

它存在的原因是两个具体的缺口：上游的 parquet 视图不挂 decompressor，ZSTD 文件直接报 `parquet unsupported compression codec: ZSTD`；而「一行一个 JSON」不是表格，硬塞进网格就丢了结构。成功的样子是：这三类文件双击就开、在真实体积下照样能用、不需要另开一个独立应用。

## Positioning

相邻选择无法诚实复制的一点：**它是「上游那个 VS Code 预览 + 全部 codec + 懒读」的组合，而不是三者之一。**

- 上游的 parquet 预览（同一个扩展、同一套 webview）在 ZSTD 上直接失败——它引用 `hyparquet` 却不加载 `hyparquet-compressors`。
- 专门的 parquet 桌面工具能开，但它们是另一个应用，呆在编辑器之外。
- 通用数据插件覆盖面更广，但不会为一个 377 MB、1M 行、60 列的文件只解码当前 50 行。

本仓库是把这个组合做到位的那一个，并且用「只保留三种格式」换取每一种都做完整。

## Operating Context

- **宿主只有 VS Code desktop**。`engines.vscode` 下限 `^1.125.0`，用 `pnpm test:smoke:min` 在下限上真跑一遍；web extension host 已放弃（ADR-0008）。
- **文件是本地文件**（CSV 额外支持 `vscode-remote:` / `vscode-vfs:`）。这些 parquet 与 JSONL 来自本机上的 polars / DuckDB 数据管线，不是远端服务。
- **真实体积是常态，不是压力测试**：377 MB parquet、1M 行、60 列；21 MB CSV。任何「小文件能跑」的实现都不算完成。
- **验收靠机器看，不靠眼睛看**：单元测试（纯逻辑）、真实 VS Code 里的激活与路由 smoke、无头浏览器的 DOM 断言 + 截图、大文件字节数与耗时预算。四层各管一件事，互不替代。
- **发版节奏**：积累若干改进后**一次性发布**，不为单个改动单独发版；发布物是 GitHub Release 上的 VSIX，tag 与打包版本号由 `check:release` 对齐。
- **语言**：界面文案英文，宿主侧字符串走 `l10n`（现有 9 个语言 bundle）；README 有英 / 简中 / 繁中三份；仓库内部文档（ADR、GLOSSARY、AGENTS）是中文。

## Capabilities and Constraints

**已确认能力（三 viewer，且都被闸门看守）**

- 表格：8 MB 以上转只读窗口视图（只渲染视口行）；更大体积先问再加载；可编辑面永远保留「用 VS Code 文本编辑器打开」这条路。
- parquet：SNAPPY/GZIP/BROTLI/ZSTD/LZ4 全解；一次一页；2 字节探针决定 ranged 还是整份读取；按行号跳转；类型感知单元格（数字右对齐、时间戳按主题着色、`BYTE_ARRAY` 显十六进制、空值显示 `NULL`）；列表与 JSON 字符串按 token 着色；整值是 `http(s)` 的单元格是链接；点 schema 字段横向跳到该列。
- JSONL：左目录右详情；字节留在宿主，webview 只拿摘要加当前一条；全文件搜索按批流式返回并带上下文。目录优先显示身份标签（顶层身份键；该键是对象时再读一层）；详情树承担摘要（大条目单行、字符串预览 120 字符；≤2,000 节点的小条目仍允许叶子换行到 2,000 字符），选中值在底栏上方展开成值面板给全文：路径、类型、字符数、换行与滚动、整值复制；标量根条目没有树行也直接给面板。单行解析上限 8 MB，超过后按原始文本显示并说明，原文超过 1,000,000 字符时明确标出截断而不是静默截断；目录窗口按 4 MB 预算加载，填不满一屏时自动补少量、末尾留一行显式 Load more。

- 全文件搜索在 1M 行上约 1.3 s，这是被性能闸门守住的不变量。

**硬约束**

- **parquet 与 JSONL 只读，表格可编辑。** 只读不是「缺功能」，是另一种承诺（GLOSSARY: Editable surface）。
- **格式集合已关闭**（interview 确认）：三种是上限，不会新增第四种。需要新格式先写 ADR，再考虑是否变成第四种——默认答案是不。
- **身份独立、可与上游共存**：`GaussAA.office-viewer-plus`，不覆盖 `cweijan.vscode-office`；上游是只读参考资料，不 merge、不 rebase（ADR-0002）。
- **严格跟随 VS Code 主题**，包括 antd 组件；没有自带的明暗开关。
- **零遥测**；上游的 telemetry 已被整体移除。
- **webview 里的东西一律不可信**：字节、URL、文件系统读取都留在扩展宿主。外部链接只有一个判据函数 `normalizeExternalUrl`（只认完整 `http(s)`、拒绝 userinfo 与控制字符、限长 2048），webview 用它决定显示，宿主在 `vscode.env.openExternal` 之前再验一次。
- **闸门 fail-closed**：typecheck 基线已清空，任何类型错误都会让构建失败；UI 验收断言主题感知对比度 ≥ 4.5:1；性能预算按 `pnpm verify:perf`。
- **未决**：尚未发布到 VS Code Marketplace 与 Open VSX（两个 registry 都 404）。发布流程与人工步骤已写在 `docs/release/`，是否启用由人决定（issue #6）。

## Brand Commitments

- **名字**：Data File Viewer (Parquet, JSONL, Excel)（Marketplace 显示名，全仓库统一；曾用名 "Office Viewer Plus" 在 Marketplace 上被拒为已占用）；发布者 `GaussAA`；扩展 id `GaussAA.office-viewer-plus`。
- **署名与许可**：MIT，fork 自 `cweijan/vscode-office`（固定来源 `forkedFrom: cweijan.vscode-office@4.2.2`），`NOTICE.md` 记录来源。
- **语气**：具体、机制优先、不自夸。README 先说清楚上游哪里坏、我们改了什么机制，并且**主动列出 Known limits**，而不是省略它们。
- **证据形态**：`docs/screenshots/` 下的截图即对外证据，由 `pnpm verify:ui --docs` 从真实 webview 重新生成，不手工修图。

## Evidence on Hand

- `docs/screenshots/*.png` —— 三份 README 引用的真实渲染截图（ZSTD、类型、浅色主题、JSONL 两栏、窗口化表格）。
- `scripts/ui-verify/` —— 无头浏览器场景与 fixture（含构造的 parquet/JSONL 文件）；断言 DOM，不止截图。
- `scripts/perf/` —— 字节数与耗时预算；大文件缓存在本地。
- `test/unit/`、`test/smoke/` —— 纯逻辑与真实宿主两层。
- `docs/adr/0001`–`0018`、`GLOSSARY.md`、`CHANGELOG.md` —— 决策、术语与逐版说明。
- **没有的**（未来工作不得编造）：用户评价、安装量、Marketplace 评分、外部基准对比、用户研究、付费/商业承诺。

## Product Principles

1. **体积是需求本身。** 一个只在示例文件上好看的预览不算做完；每个 viewer 都要在维护者真实打开的体量上验证过。
2. **能力边界要明说。** 只读就说只读、没写就说没写——Known limits 与 ADR 里的「不做」，与做出来的功能同等重要。
3. **用机器判断，而不是用眼睛判断。** UI 改动靠 DOM 断言 + 字节/耗时预算决定去留，截图只是记录结果。
4. **边界上收，内部放开。** 跨到宿主之外的东西（文件字节、外部链接、系统调用）都必须经过一个可测试的收口点；收口之后的内部实现可以大胆。
5. **窄而完整 > 宽而将就。** 三种格式，每种做到底；多出来的格式不是能力，是维护债。

## Accessibility & Inclusion

- **关键路径必须全键盘可达**（interview 确认的硬要求）：新增交互必须同时给出键盘路径与可见焦点。现有实现：JSONL 的 `←`/`→` 展开与收起、`Space` 切换、`Enter` 打开或收起值面板、`Ctrl+C` 复制值、`Ctrl+Shift+C` 复制路径、`Esc` 收起值面板；链接单元格 `Enter`/`Space` 打开，按钮式列表项带 `aria-pressed` 与 `:focus-visible`。
- **对比度**：UI 验收按主题断言链接色与 JSON token 色 ≥ 4.5:1，不得为了好看放宽。
- **未承诺**：没有成文的 WCAG 等级目标，也没有做过屏幕阅读器验证——不要对外声称达标。
