# ADR-0026 跨 viewer 缓存：JSONL 索引落盘、Excel 先测量

- 状态：已接受（2026-11-18，方向；实现待做）
- 日期：2026-11-18

## 背景

6.16.0 之后，parquet 已有 ADR-0025 的三层缓存；JSONL、Excel/CSV 仍然按需重读/重解析。
ADR-0025 当时明确只做 parquet，并把 JSONL/Excel 留到后续；它否决“通用跨 viewer 缓存平台”，
理由是格式差异尚未审计。现在审计（2026-11-18，HEAD `56467fdc`）把差异落成了事实：

- **JSONL**：索引在 host（`buildJsonlIndexFrom` 顺序读全文，8 B/行，`src/service/jsonlFile.ts:58`），
  没有磁盘缓存；窗口 4 MB/500 行，读时重建窗口局部索引（`jsonlSession.ts:76`）；搜索
  8 MB/20k 行/轮，无 query memo（`jsonlAdapter.ts:38`）；UI 状态 `jsonl-state` 只有
  `{left, selected, mode}`，无 TTL/version（`jsonlPersistence.ts:10`）；JSONL info 不带 mtime；
  多标签共享同一 session/index。
- **Excel/CSV**：解析、窗口、搜索、find 全在 webview（`excel_reader.ts:162`、
  `sheetWindowReader.ts:16`、`sheetSearch.ts:16`）；host 只给 URI，从不读文件字节；每个标签/
  重开都重新 fetch + parse；CSV 源在一次全量扫描里保留整份 bytes + 8 B/行偏移
  （`sheetSource.ts:111`）；`excel-view` 只有 `{ri, ci, sheetIndex}`，无 TTL/version
  （`excelViewState.ts:11`）；office 打开消息有 mtime，但 Excel/CSV 没用它。
- **JSON Preview** 是命令预览，不在本轮范围。
- **持久化全在 webview `localStorage`**，没有 host 磁盘存储；`savePersistedState` 只有
  LRU 20/前缀，没有 TTL/version（`src/react/common/persistedState.ts:10`）。
- **Clear** 只认 parquet（`GaussAA.office.clearParquetCache`，`src/extension.ts:31`）。
- **数据边界**：JSONL 索引只含偏移；UI 状态只有位置/模式；Excel 解析结果与 CSV bytes 是用户
  数据；CSV 偏移是派生聚合。

约束与既有方向一致：值不落盘；按文件、跨 VS Code 重启；`size + mtime + 版本` 失效；不自动
预热；发布先积累（列高亮修复不单独发版；版本号与这批缓存一起定）。

## 决定

### 1. 策略沿用 ADR-0025，按 viewer 适配

| 层                           | 存什么                                                           | 寿命 / 预算                                | 失效                                              |
| ---------------------------- | ---------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------- |
| **host 磁盘**（本 ADR 新增） | JSONL 行索引（纯偏移）；将来 CSV 行偏移                          | 单文件 ≤16 MB、总 ≤64 MB、LRU 5、数据 7 天 | `documentCacheId + size + mtime + 版本`、TTL、LRU |
| **webview localStorage**     | JSONL/Excel UI 状态；parquet 既有聚合/UI                         | UI 90 天；每前缀 LRU 20                    | `cacheId + 版本 + TTL`、损坏/形状错删除           |
| **host 内存**                | JSONL 索引（从磁盘载入）；parquet 单列扫描；将来的 host 解析缓存 | VS Code 会话；按文件 LRU                   | 文件指纹、Clear、LRU                              |
| **webview 内存**             | JSONL 搜索 memo；Excel find memo；已解析的 Excel 源与窗口块      | 标签关闭即失；memo 最多 3 条               | 文档变化、Clear、标签关闭                         |

**值只在内存**：JSONL 搜索命中、Excel 单元格、CSV 解码结果都不落盘。JSONL 索引、UI 位置/模式、
CSV 偏移不含值，才允许落盘。UI 状态不需要 mtime（布局与内容无关），用 `cacheId + 版本 + TTL`；
数据型缓存才用文件指纹。

### 2. 共享策略 + 小工具，不抽完整平台

新增四个共享小件，缓存对象仍按 viewer 分开：

- **指纹**：`documentCacheId + size + mtimeMs + 版本` 的类型与比较函数。
- **Host disk store**：`context.globalStorageUri` 下的通用条目存储（元数据 + 二进制 payload），
  提供 `get/set/delete/clear`、TTL/LRU/总量上限、原子写（临时文件 + rename）、损坏/版本不符
  删除。它只负责字节，不解释内容；“只存聚合”由调用方保证。
- **Webview 状态包装**：在 `savePersistedState` 之上加版本/TTL/旧格式迁移/统一删除；不替换
  现有 LRU 20。
- **Clear registry**：host store + host 内存缓存 + 各 provider 打开的视图 + webview 键前缀，
  由一条命令统一调用。

**不迁移 parquet 的存储实现**：parquet 的 share/UI 仍在 webview localStorage，scan cache 仍在
host 内存；只在指纹/TTL/状态包装/Clear 注册这些边界上复用。ADR-0025 否决的是“未审计差异就抽
完整平台”；本 ADR 只抽已经确定同形的策略与小工具，缓存对象与生命周期仍按 viewer 保留差异。

### 3. JSONL：索引落盘、UI 迁移、搜索 memo

- **索引**：新增 host 磁盘缓存。键 `documentCacheId + stat.size + stat.mtimeMs +
  JSONL_INDEX_VERSION`；值是 `lineCount + 每行起始字节偏移`（8 B/行，二进制）；命中直接构造
  `JsonlFile`，不调用 `buildJsonlIndexFrom`。provider 在打开时 stat 一次；没有 mtime/非 `file:`
  文档跳过磁盘（仍可在 host 内存建索引）。
- **预算**：单索引 ≤16 MB（约 2M 行）、总量 ≤64 MB、LRU 5 个文件、7 天；超出单文件上限就
  不写盘；写前淘汰最旧条目；版本/TTL/损坏删除。JSONL 索引只含偏移，不含任何值。
- **UI 状态**：`jsonl-state:<cacheId>` 升级为 `{v, ts, left, selected, mode}`，TTL 90 天；读取
  旧的无版本对象时原地迁移（不丢现有位置/模式），损坏或形状错直接忽略。
- **搜索 memo**：在 webview 内保留最近 3 条规范化 query 及其结果（受 10k 命中上限约束），
  标签关闭即失；文档变化、文件变化、Clear 清空。命中不再向 host 发搜索请求；host 的
  `JsonlAdapter.search` 与 cancel 语义不变。memo 只在内存，不落盘。
- **不做窗口缓存**：4 MB/500 行的窗口本身就是有界读取，缓存收益不足以抵消状态面；留到有
  perf 证据再议。

### 4. Excel/CSV：值只在 webview，先测量

- **不做 host 解析缓存（本轮）**。审计确认解析 100% 在 webview；把解析搬到 host 会改动
  fetch/解析/窗口/编辑保存整条路径，是一次独立的重构，不能用“先加个缓存”掩盖。
- **UI 状态**：`excel-view:<cacheId>` 升级为 `{v, ts, ri, ci, sheetIndex}`，TTL 90 天；旧对象
  原地迁移；不新增列宽/搜索词字段（列宽/搜索词落盘是另一个隐私与迁移决定）。
- **find memo**：webview 内最近 3 条查询与命中行索引，标签关闭即失；文档变化、Clear 清空；
  不落盘、不进入 UI 状态。
- **测量（首个里程碑的一部分）**：在现有大工作簿/CSV fixture 上测打开到首屏的
  `XLSX.read` + `workbookRowsFromSheetJs` / CSV scan 耗时与堆；判据：**parse >1.5 s 或 parse
  占打开时间 >50%** 才另开 ADR/切片做 host 解析缓存（host 内存、按指纹、跨标签/会话、值不
  落盘）。未触发就保持 webview 解析。
- **CSV 偏移**：不在本轮。若测量显示 CSV scan 是显著成本，再评估把 8 B/行偏移放进 host
  disk store；仍只存偏移，不存值。

### 5. 统一 Clear

- 新命令 `GaussAA.office.clearDataViewerCaches`，标题 **Clear Data Viewer Caches**，分类
  `Data File Viewer`；确认框列出 parquet/JSONL/Excel，不包含 JSON Preview。
- 旧 ID `GaussAA.office.clearParquetCache` **保留注册作为别名**，从 `contributes.commands`
  移除（命令面板只显示新命令，已有键位仍可用）；两个入口调用同一实现。
- 清理范围：
  - host disk store（JSONL 索引；将来的 CSV 偏移）；
  - host 内存（parquet scan cache；将来的 host 解析缓存）；
  - webview localStorage：parquet share/UI、JSONL UI、Excel view；JSON Preview 键不动；
  - webview 内存：parquet/JSONL/Excel 的搜索/find memo；
  - 打开的视图立即重置：parquet 沿用现有重置；JSONL 清空搜索并回到文档开头/当前选中行失效
    的干净状态；Excel 清空 find 并重新载入当前 sheet；
  - 没有打开视图时，host 记 one-shot，下一次打开先清再加载；host disk store 立即删除。
- Clear 不删除用户文件、不改写 JSONL/Excel/CSV 内容。

### 6. 范围外

- JSON Preview（命令预览）不纳入本轮缓存与 Clear。
- Excel 值落盘、Excel host 解析缓存（测量触发后再开 ADR/切片）。
- CSV 偏移缓存（测量后可选）。
- JSONL 窗口缓存、自动预热、跨机器同步、完整通用缓存平台。
- 版本号与发布；本 ADR 的实现先积累，列高亮修复与缓存一起发，版本号发布时再定。

## 预算、失效与并发

- JSONL 索引：16 MB/文件、64 MB 总量、LRU 5、7 天；超限不写；版本/TTL/损坏删除。
- UI：90 天；每前缀 LRU 20；无版本/损坏删除；旧格式迁移一次。
- 搜索/find memo：每 webview 3 条；内存；文档变化/Clear 清空。
- 指纹：`size + mtimeMs + 版本`；JSONL 索引在 provider stat；同一秒内同 size 的改写无法
  发现，接受为已知边界。
- 多标签：JSONL 索引由 host 共享，磁盘只加载一次；Excel/CSV 仍是每标签 webview 解析，
  本轮不引入共享值缓存。Clear 对打开的多个标签统一广播。
- 写盘：临时文件 + rename；启动/写入时做 TTL/LRU/总量 GC；损坏条目静默删除。

## 验收

- **JSONL 命中零全量读**：用计数的 ByteSource 断言缓存打开没有顺序扫全文；索引行数/偏移
  正确；size/mtime/version/TTL/LRU/损坏/no-mtime 各自 miss 的行为有单测；多标签共享。
- **UI 迁移**：旧 `jsonl-state`/`excel-view` 能读并写回新格式；90 天/TTL、损坏、Clear 生效。
- **memo**：重复 query 不再触发 host 搜索；文件变化/Clear 清空；结果上限与 3 条上限生效。
- **Excel**：测量数字记录在 `docs/agents/perf.md` 或本 ADR 附录；UI/find memo 生效；断言
  localStorage/globalStorage 中没有单元格值。
- **Clear**：新命令/旧别名都清 parquet/JSONL/Excel；打开的视图重置；无视图 one-shot；
  JSON Preview 键保留；不误删用户文件。
- **perf**：JSONL 冷路径不退化；缓存打开新增一条计时/字节观测；Excel/CSV 测量进入 perf
  报告；现有 13 项闸门不变。
- **测试**：host disk store（TTL/LRU/总量/原子/损坏/版本）、JSONL 索引读写、UI 迁移、搜索
  memo、Clear 命令与 one-shot、UI 场景；不把墙钟当 CI 门槛。

## 实施顺序

1. 共享小工具（指纹、host disk store、webview 状态包装、Clear registry）+ 新命令/旧别名。
2. JSONL 索引磁盘缓存 + UI 迁移 + 搜索 memo + 单测/UI/perf。
3. Excel/CSV 测量 harness + UI 迁移 + find memo；执行测量并记录结论。
4. 仅当测量触发：Excel host 解析缓存或 CSV 偏移缓存（另开 ADR/切片）。
5. 与列高亮修复一起积累发布；本 ADR 不承诺版本号。

首个里程碑 = 1 + 2 + 3 的测量部分；Excel host 解析与 CSV 偏移按测量结果决定。

## Considered Options

- **JSONL 索引存 webview localStorage**：8 B/行很快撞 5–10 MB 配额，大文件不可用；否决。
- **JSONL 索引只放 host 内存**：无新磁盘层，但重启后仍全量扫；与“跨重启”目标不符；否决。
- **不做 JSONL 索引缓存**：零基础设施，但最大的一笔重复读留在原地；否决。
- **Excel 解析直接搬 host**：真正解决重开/多标签解析，但改动 fetch/解析/窗口/保存整条路径；
  在没有 parse 占比数据前风险过大；本轮先测量，触发后再做。
- **Excel 解析结果落盘**：重开最快，但单元格值落盘、体积与隐私边界不可控；与策略冲突；否决。
- **Excel 保持 webview 且完全不做解析缓存**：安全但不解决任何重开成本；测量分支保留可能性。
- **CSV 偏移先落盘**：派生聚合、可落盘，但收益取决于 scan 占比；先测量，暂缓。
- **抽完整通用缓存内核**：ADR-0025 已因差异未审计否决；审计后差异仍是 host/webview、偏移/
  值的分裂；只抽策略与小工具。
- **每个 viewer 一条 Clear**：可控，但与“统一清理”的用户预期冲突；否决。
- **沿用 `clearParquetCache` 的 ID 清所有 viewer**：不新增命令，但名字会骗人；否决，新增
  ID + 旧别名。
- **JSON Preview 一起纳入**：它是命令预览，与文件 viewer 的打开路径不同；本轮范围外。
- **自动预热/后台解析**：违背显式缓存与不打乱首屏预算的方向；否决。

## 后果

- **收益**：大 JSONL 重开不再顺序扫全文；重复搜索直接命中 memo；JSONL/Excel 的布局不再因
  升级丢失；Excel 的重开成本有了可复现的测量与 go/no-go；一条命令能清干净三个 viewer。
- **代价**：新增 host 磁盘存储（路径/GC/原子写/损坏处理）；JSONL provider 需要一次 stat；
  两个 UI 状态需要迁移；Clear 从 parquet 专用变成跨 provider 的注册表；测试面增加
  （磁盘命中/失效/预算/迁移/清理）。
- **已知边界**：超过 16 MB 的索引不落盘；同 size + 同 mtime 的改写无法发现；Excel/CSV 本轮
  仍会重解析；CSV 偏移与 Excel host 解析是测量后的分支；JSONL 搜索 memo 是每标签的；
  JSON Preview 不参与；不跨机器同步；不自动预热。
- **与 ADR-0025 的关系**：不是推翻，而是补上它明确留出的后续；共享范围严格限制在策略与
  小工具，不改变 parquet 的三层与“值只在内存”的边界。

## 审计附录（2026-11-18，HEAD `56467fdc`）

| 操作             | 入口                                           | 成本 / 现状                              | 本轮决定               |
| ---------------- | ---------------------------------------------- | ---------------------------------------- | ---------------------- |
| JSONL 索引       | `buildJsonlIndexFrom`（`jsonlFile.ts:58`）     | 全文顺序读，8 B/行，无缓存               | host 磁盘缓存          |
| JSONL 窗口       | `JsonlSession.readRange`（`:76`）              | 4 MB/500 行，读时重建窗口索引            | 不缓存                 |
| JSONL 搜索       | `JsonlAdapter.search`（`:38`）                 | 8 MB/20k 行/轮，10k 命中，无 memo        | webview query memo     |
| JSONL UI         | `jsonlPersistence.ts:10`                       | `{left, selected, mode}`，无 TTL/version | 版本/TTL + 迁移        |
| Excel 解析       | `excel_reader.ts:162`                          | 全在 webview，每标签/重开重解析          | 先测量，不搬 host      |
| Excel 窗口       | `sheetWindowReader.ts:16`                      | 64 行 block，单块缓存                    | 保持                   |
| Excel 搜索       | `sheetSearch.ts:16`                            | 2,048 行/批，5k 行上限                   | webview find memo      |
| Excel UI         | `excelViewState.ts:11`                         | `{ri, ci, sheetIndex}`，无 TTL/version   | 版本/TTL + 迁移        |
| CSV 源           | `sheetSource.ts:111`                           | 全量 bytes + 8 B/行偏移，单块窗口        | 测量；偏移缓存暂缓     |
| 持久化           | `persistedState.ts:10`                         | LRU 20/前缀，无 TTL/version              | 状态包装复用           |
| Clear            | `extension.ts:31`                              | 仅 parquet 的 scan + one-shot            | 统一 registry/命令     |
| parquet 可复用件 | `parquetScanCache.ts:30`、`savePersistedState` | 指纹/LRU/读-合并-写模式                  | 小工具复用，不整体迁移 |
