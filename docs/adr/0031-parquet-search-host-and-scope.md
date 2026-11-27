# ADR-0031 parquet 搜索：宿主扫描、范围收窄、三层命中

- 状态：已接受（2026-11-27，已实现）
- 日期：2026-11-27
- 取代：[ADR-0025](./0025-parquet-cache-layering.md) 中「搜索只做每 webview 的 query memo」与
  「搜索全在 webview」两项；[ADR-0020](./0020-column-profile-direction.md) 的 host 能力迁移继续适用

## 背景

一个真实的 HF 元数据导出（`cards.parquet`，138.6 MB、268,548 行、8 列，其中 `readme` 是
122 MB 的长文本）搜索一个 URL：

- **webview 侧实测 12–17 s**，webview 堆峰值 1.1–1.2 GB（429 MB 解码字符串 + 每个值再
  `toLowerCase()` 的副本）。用户感知是「搜一个 URL 要很久」，同时 UI 会卡。
- 分解：`readme` 的 zstd 解压约 7 s（`hyparquet-compressors` 用纯 JS fzstd）、字符串解码
  约 1.2 s、匹配约 1.7 s、其余 7 列约 2 s。换正则只能再快 10–15%，换 WASM zstd 能快
  1.5–2x，但**只搜 `url` 一列**只要 0.38–0.46 s——范围是唯一一个数量级杠杆。
- 搜索在 webview 还意味着：大文件搜索与渲染抢主线程，且结果 memo 只活在一个 webview。

产品要求：保持「搜所有列」的默认语义；用户必须能选择「只搜当前列 / 只搜可见列」；大文件
搜索不能卡 UI；高亮要能看出命中在哪一列、哪一行。

## 决定

### 1. 扫描搬到扩展宿主

webview 不再 import 解码器。请求只带 `requestId`、query 和**绝对列位置**；host 用
`openDocumentSource` 的 `ByteSource` 打开文件，`openParquetFile` 取 metadata，复用
`searchParquetValues`（已移到 `src/service/parquetSearch.ts`）逐列 page-aligned 扫一遍。
host 通过 `parquetSearchProgress` 节流上报，`parquetSearchCancel` 置 token；每个 panel
保留最近 3 个「query + 列范围」结果，Clear cache 一并清空。

这样做的收益不只是速度：webview 不再堆 1.1 GB 的临时字符串；扫描失败/取消也不会把半截
结果画到表上。代价是**只有文件-backed 文档能搜**（inline/virtual 文档没有 host 路径），
这类文档的搜索按钮会明确报错，而不是静默回退到 webview 扫描。

### 2. 范围是一个参数，不是隐藏语义

搜索框旁的下拉：**全部列 / 当前列 / 可见列**。默认「全部列」；「当前列」指 schema 高亮的
那一列，没有选中时禁用；「可见列」指表格实际渲染的列（列显隐开启时就是选中集，否则全部）。
范围按文件记住，但重开文件时「当前列」回退到「全部列」，因为 active 列不持久化。改范围会
清空当前结果，避免结果集声称一个它并非在那个范围下产生的范围。

### 3. 匹配语义不变，只去掉字符串的 formatter 开销

保留 `formatCellValue(...).toLowerCase().includes(...)` 的结果：土耳其 `İ`、`ſ` 等 Unicode
边缘行为不变。唯一改变是 `typeof value === "string"` 且不是 binary-like 类型时直接用原串，
跳过 formatter（formatter 对普通字符串本来就是 identity）。拒绝手工 ASCII 扫描（实测比
baseline 慢）和正则替换（快 10–15% 但会改变上述边缘语义）；也不换 WASM zstd，那是影响
所有 parquet 读取的独立议题。

### 4. 三层命中，搜索期间持续

- 命中文本 `<mark class="parquet-viewer__hit">`：VS Code find-match 色块 + 深色文字；
- 命中行：加重的行底 + 左侧 3px 强调条；
- 命中列：列头徽标 + 整列淡琥珀底（与「选中列」的蓝色 tint 分属两个信号色）。
  每个命中行只记录**第一个**匹配列（搜索本来就只返回这个列号），因此列高亮是「行级首个命中列」
  的并集；命中落在被列显隐隐藏的列时，保持隐藏，行/文本照常高亮，顶部给「N 列已隐藏」按钮
  一键把命中列加回可见。

### 5. 验收

- 范围搜索：139 MB / 26.9 万行上只搜 `url` 列 <1 s（Node 侧实测 0.38–0.46 s）；
  1M 行夹具全量搜索仍在 12 s 预算内（host 实测 2.5–3.8 s）。
- 全量搜索不再冻结 webview；宿主扫描期间进度条与停止按钮可用。
- `pnpm verify:perf` 的 `parquet-search-scoped-column`：60 列 × 200k 行的单列搜索
  ≤2.5 s，且结果与全量一致（实测 0.37 s）。
- `pnpm verify:ui`：`parquet-search`、`parquet-search-scope`、`parquet-search-highlight`。

## 实施记录

- `src/service/parquetSearch.ts`：扫描与 `columns` 选项；`src/common/parquetSearchTypes.ts`：wire 类型。
- `src/provider/parquetHandlers.ts`：`search` / `cancelSearch` / `clearSearchCache`；host memo。
- `src/provider/officeViewerProvider.ts`：消息接线与 Clear cache 联动。
- `src/react/view/parquet/useParquetSearch.ts`：请求身份、取消、scope 持久化；host 回复入 hit set。
- `src/react/view/parquet/ParquetTopBar.tsx`：范围下拉与隐藏命中提示。
- `scripts/ui-verify/parquet-search-host.ts`：UI/perf harness 用同一个 service 回答，避免在页面里
  复制一份扫描语义。
- 测试：`test/unit/parquet-search.test.ts`（范围、binary formatter 语义）、
  `test/unit/parquet-search-host.test.ts`（memo、取消、错误、Clear）。
