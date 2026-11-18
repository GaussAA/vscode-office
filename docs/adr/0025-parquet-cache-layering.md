# ADR-0025 parquet 缓存分层：聚合落盘、样本进 host 内存

- 状态：已接受（2026-11-18，方向；第一块已落地，其余待做）
- 日期：2026-11-18

## 背景

6.15 之后，parquet 已经有四类重复工作：只读 footer 的列画像、显式单列扫描（top-N）、批量
empty-share 扫描、按页解码与全文件搜索。现状是**缓存按功能各长一块**：画像每次重读 footer；
单列扫描结果只活在面板里；empty-share 结果落盘但整表覆盖；页面是每 webview 的 3-chunk/64MB
内存缓存；搜索没有 query memo，换查询就重扫。审计（2026-11-18，HEAD `75838e96`）得到的事实：

- **搜索全在 webview**：1M 行约 2.3 s，结果只留在 ref，没有 memo，不能跨标签
  （`src/react/view/parquet/parquetSearch.ts`）。
- **页面缓存是每 webview**：5,000 行/chunk、3-chunk LRU、64 MB range cache
  （`parquetSession.ts`、`src/react/util/parquetSource.ts`）；host 侧 parquet **没有 session**，
  多标签各自独立。
- **落盘只有 empty-share 聚合**：`parquet-shares:` 整表覆盖；容量 20 条 LRU + 7 天 TTL；
  两个标签各扫不同列时可能 last-write-wins（`parquetShareCache.ts`）。
- **UI 状态是两套键**：行位置用 `payload.path`（webview 会话相关），列宽/侧栏宽是全局键且
  从不清理（`parquetLayout.ts`、`parquetPersistence.ts`）。
- **profile 不值得缓存**：只读 footer，实测 5.7 KB / 3 ms；缓存它只会增加失效面。
- **值在哪里**：画像的 min/max、单列扫描的 top-N、搜索/页面 chunk 都含真实数据值；empty-share
  只有计数。

产品约束同样明确：ADR-0020 规定首屏不解码；`verify:perf` 守着 profile ≤256 KB / 300 ms、
单列扫描 ≤178 KB / 2000 ms、首屏字节与页面耗时；DESIGN 不允许把缓存状态做成第二个仪表盘。

本轮与维护者逐项确认的取舍是：**只做 parquet**；跨 VS Code 重启、按文件；**磁盘只存聚合与
布局，数据值只进内存**；`size + mtime + 版本 + TTL` 失效；自动 LRU/TTL + 一条 Clear cache；
顶部样本值在 host 内存按文件 LRU、随会话结束；搜索只做每 webview 的 query memo；页面只调优
现有 webview 缓存；不自动预热；多标签写入用 read-merge-write；数据 7 天、UI 90 天；侧栏宽
保持全局偏好；验收以**命中零数据页读取 / 零新增解码**为准，墙钟只做观测。

## 决定

### 1. 三层，各存各的

| 层                               | 存什么                                                              | 键                                                                                        | 寿命 / 预算                            | 失效                                                 |
| -------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------- | ---------------------------------------------------- |
| **磁盘**（webview localStorage） | empty-share 聚合；per-file UI（列宽、当前行、字段过滤）；侧栏宽全局 | `parquet-shares:<documentCacheId>`、`parquet-ui:<documentCacheId>`、`parquet-sider-width` | 数据 7 天、UI 90 天；每前缀 LRU 20     | `size + mtime + CACHE_VERSION`、TTL、损坏/形状错删除 |
| **host 内存**                    | 单列完整扫描（top-N、计数、覆盖率）；批量扫描复用                   | `documentCacheId + size + mtime + SCAN_VERSION`                                           | 按文件 LRU 3；VS Code 会话；跨标签共享 | 文件指纹、Clear、LRU                                 |
| **webview 内存**                 | 搜索 query memo（默认 3 条 / 8 MB）；页面 chunk/range               | 每 webview / 每文档                                                                       | 标签关闭即失                           | 文件变化、Clear、文档切换                            |

**磁盘继续留在 webview localStorage**，不是 host-owned：现有 share 缓存、行恢复、JSONL/Excel
状态都在这一层；搬家的收益（host 可清、跨标签串行）不足以抵消 UI 状态每次改宽/改行的 IPC。
Clear cache 在没有 parquet 视图打开时由 host 记一个 one-shot 标记，下次打开先清再加载。

### 2. 磁盘：聚合 + 布局，合并写入

- **empty-share**：沿用现有结构（`name/scanned/rowCount/complete/nulls/empties/emptyRatio`），
  写入改成**读-合并-写**：读取当前同指纹条目，按列名合并，新扫描的列覆盖旧列；指纹不符或条目
  损坏则整条替换。两个标签同时写的极小竞态接受，作为已知边界记录。
- **UI 状态**：`{ columnWidths, row, fieldFilter }`，按 `documentCacheId` 存；列宽按列名保存，
  行/字段过滤按字段保存；read-merge-write（列宽 map 作为字段整体替换，行/过滤字段最后写胜）。
  旧 `parquet-column-widths` 作为**首读 fallback**（用户已有布局不丢），旧 `parquet-state:<path>`
  的行位置在首次打开时读一次并写入新键。侧栏宽保持单个全局偏好（`parquet-sider-width`），
  Clear 会重置；它不参与 per-file TTL，避免“90 天没拖过就丢宽度”。
- **容量**：复用 `savePersistedState` 的 LRU 20/前缀与配额失败静默；数据 7 天、UI 90 天；
  版本不符、过期、形状错、损坏一律删除，不把坏数据画到 UI。

### 3. host：单列扫描缓存

- 新增 host 侧 `ParquetScanCache`（模块级或 extension context，单例）：键
  `documentCacheId + size + mtime + SCAN_VERSION`；值是完整的 `ParquetColumnScan`
  （top-N、计数、覆盖率）。命中直接返回，不解码、不打开 source。
- **按文件 LRU 3**，随 VS Code 会话结束；同一列的并发请求做 in-flight 合并；文件变化（新
  fingerprint）自然 miss；`Clear cache` 清空。
- 批量 empty-share 扫描优先复用缓存里的完整单列结果；没有命中才解码。这样“先看一列，再批量”
  和“先批量，再开面板”都不会重复扫同一列。
- 内联/无 `mtime` 文档不缓存（与 share 缓存同一规则）；webview 仍可显式扫描，只是不落缓存。

### 4. webview：搜索 memo 与页面调优

- **搜索**：在 `useParquetSearch` 里加每文档 query memo（规范化 query → hit set + row list），
  默认 3 条 / 8 MB，标签关闭即失；文件变化/清除清空。命中不重扫；不落盘、不上收 host。
- **页面**：保留现有 `ParquetSession` 3-chunk/64 MB 缓存，只测 chunk 数与预取距离（默认 4 chunk
  - 一页预取，只有 perf 改善才保留）；不落盘、不改变冷路径预算。

### 5. 失效、并发与清理

- 所有磁盘/ host 条目以**文件指纹**为准：`size + mtimeMs + 版本`；UI 状态只用 cacheId + TTL，
  因为布局不依赖文件内容。mtime 由 host 的一次 stat 同时提供（`open` 消息的 `mtimeMs`）。
- **多标签**：磁盘按列名/字段 read-merge-write；host 内存是样本值的唯一源；同字段最后写胜。
  不为缓存引入“一个文件一个标签”的限制。
- **Clear cache**：命令面板一条命令 + 确认框；清磁盘前缀、host 内存、搜索 memo，并让打开的
  parquet 视图立即重置（布局、行、filter、徽标回到默认）；不碰 JSONL/Excel。没有打开视图时
  host 记 one-shot 标记，下次打开先清。

### 6. 验收

- **命中不产生新的数据页读取，也不产生新的扫描/搜索工作**：share/UI 直接读 localStorage；
  搜索直接返回 memo；host top-N 允许一次缓存 lookup 请求，但不许 `parquetReadObjects`/数据页。
  表格正常分页读取不计入命中成本。
- **冷路径不变**：profile ≤256 KB / 300 ms；单列扫描 ≤178 KB / 2000 ms；首屏字节预算与页面
  耗时不上涨。墙钟只做观测，不做 CI 门槛。
- **测试**：单测覆盖 key/merge/TTL/version/corrupt/LRU/clear；UI 场景覆盖重开徽标、UI 恢复、
  面板命中、搜索 memo、Clear 重置；perf 覆盖命中字节/请求数与页面调优。

## Considered Options

- **只扩展现有 share 缓存（top-N/search/UI 都不动）**：成本最低，但用户日常等待最大的是面板
  top-N 与重复搜索；否决，作为第一块之后的增量没有意义。
- **把搜索/页面/UI 全部上收 host**：能跨标签且 host 可统一清理，但要重写 ADR-0020 明确留在
  webview 的读路径，风险和回归面远大于收益；否决。
- **全量 localStorage（含 top-N/search/page）**：重开最快，但数据值落盘、体积不可控、隐私边界
  模糊；与本轮“值只在内存”的决定冲突；否决。
- **通用跨 viewer 缓存平台**：抽象先行，JSONL/Excel 的格式与生命周期差异大；会卡在架构上；
  否决，先做 parquet 的三层。
- **一个文件只允许一个标签**：能消除并发，但改变 VS Code 的多标签行为；否决。
- **打开即后台预热**：违背 ADR-0020 的零解码首屏预算，且需要新预算/取消 UI；否决，保持显式。

## 后果

- **收益**：重开文件时徽标与布局不再等扫描；同一会话内 top-N 面板可跨标签秒开；重复查询不重扫；
  多标签不再丢 share；一条命令能真正回到干净状态。
- **代价**：host 需要新增缓存服务与指纹传递；磁盘 read-merge-write 有极小竞态；UI 状态从全局键
  迁到 per-file 键，需要一次 fallback 迁移；测试面增加（缓存命中/失效/清理/多标签）。
- **已知边界**：刻意保留 size+mtime 的写入无法发现；两个标签同时读-合并-写仍可能丢一个同列
  更新；内联/无 mtime 文档不缓存；profile 与 JSONL/Excel 不在本轮；不跨机器同步。
- **实施顺序**：
  1. UI 状态恢复（列宽/行/字段过滤，侧栏全局，90 天，旧键 fallback）+ share 合并写入 + 单测
     （已完成）。
  2. host 单列扫描缓存 + 批量复用 + Clear cache 命令（此时才真正“全清”）。
  3. 搜索 query memo。
  4. 页面 chunk/预取调优（按 perf 结果取舍）。
- **默认值**（可调）：host LRU 3 个文件；search memo 3 条 / 8 MB；页面 4 chunk + 一页预取；
  数据 7 天 / UI 90 天；每前缀 LRU 20；命令名 `GaussAA.clearParquetCache`。

## 审计附录（2026-11-18，HEAD `75838e96`）

| 操作             | 入口                                   | 成本 / 现状                    | 本轮决定              |
| ---------------- | -------------------------------------- | ------------------------------ | --------------------- |
| footer/profile   | `readParquetProfile`                   | 5.7 KB / 3 ms，无缓存          | 不缓存                |
| 单列扫描         | `scanParquetColumn`                    | ≤200k 行，面板关闭即失         | host 内存缓存         |
| 批量 empty-share | `scanEmptyShares`                      | ≤32 列 × 200k 行，落盘整表覆盖 | 磁盘 + 合并写入       |
| 页面             | `ParquetSession` / `RangeCache`        | 3 chunk / 64 MB，每 webview    | 调优，不落盘          |
| 全文件搜索       | `searchParquetValues`                  | 1M 行 ~2.3 s，无 memo          | webview query memo    |
| UI 状态          | `parquetLayout` / `parquetPersistence` | 全局列宽/侧栏，path 行键       | per-file + 全局侧栏   |
| 持久化           | `savePersistedState`                   | LRU 20 / 前缀，无 TTL          | 分层 TTL + 删除坏条目 |
