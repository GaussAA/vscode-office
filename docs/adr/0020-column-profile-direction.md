# ADR-0020 下一步方向：上收 parquet 读路径，先做列画像

- 状态：已接受（2026-11-12，6.8.0 之后）
- 日期：2026-11-12

## 背景

6.8.0 之后，这个仓库进入了一个此前没有过的状态：issue 与 PR 全关、`[Unreleased]` 为空、HEAD
与 tag 重合、三个 viewer 全部过四层闸门。也就是说「还差什么」不再由 backlog 定义，只能由产品
自己定义。

两条既有约束决定了可选空间：

- **格式集合已关闭**（ADR-0015），而 `Native preview` 判据在宿主侧仍然成立：VS Code 至今没有
  CSV / parquet / JSONL 预览（microsoft/vscode#183720 被 close as _not planned_）。所以「再加
  一个格式」不是一条路。
- **parquet 是旗舰，却是全仓最不可测的一层**：它的字节源、分页、搜索全部在 webview
  （`src/react/util/parquetSource.ts`、`src/react/view/parquet/parquetSearch.ts`），
  `src/service` 下没有任何 parquet 文件；同一件事在 JSONL 上已经是宿主侧的 session。

真正缺的能力在另一处：三个 viewer 都只回答「这里有什么」，不回答「这一列有没有问题」。维护者
的日常是质检式的（空值率、基数、取值范围、哪些行命中），今天只能回去写脚本，而「不写脚本」
正是这个扩展存在的理由。

## 决定

主轴是从「看」到「问」；第一批落地的是**列画像（Column profile）**。

1. **只新增一条宿主侧接缝**：`metadata` / `profile`。分页与搜索暂留 webview，谁需要变才搬谁
   （按能力上收）。「一次全搬进 service」被否：它与「每周固定几小时」的节奏冲突，而且期间产品
   零产出。
2. **画像先用元数据**：`null_count` / `min` / `max` 直接来自 parquet 的 row-group statistics，
   不需要解码任何一列；基数与 top-N 按需扫**单列**。
3. **没有统计的文件要说出来**：row-group statistics 是 writer 可选的。文件没写统计时明说
   「该文件未写 row-group statistics」，并给一个「扫描这一列」的动作；不自动整份解码。
4. **UI 复用 schema 侧栏**：字段行内加 null% 徽标与区间，点开看 top-N。不新增 pane，不新增视觉
   世界（DESIGN.md 的 Instrument Bay 与三件套布局不变）。
5. **验收先于界面**：第一个 PR 只包含新 fixture、宿主侧 metadata 接缝、一条新预算，以及把
   `verify:perf` 加进 `.github/workflows/main.yml`。UI 留到第二个 PR。
6. **两文件对比是下一步**，做成 Command preview（沿用 ADR-0019 的形态：命令打开、不注册文件
   关联），需要另写 ADR。本 ADR 不承诺它。
7. **表格的可编辑面冻结**：只修数据丢失、崩溃与安全问题，其余一律不做。它是全仓最大的维护面
   （vendored `x-spreadsheet` 13,839 行 + 一手 7,919 行），而上游 `x-spreadsheet` 已无人维护。
8. **README 的 "Known limits" 拆成两个词**：Non-goals（永不做，带理由，进 ADR）与 Known gaps
   （承认的洞，带判据，可被下一步认领）。列画像是 Known gaps 里第一条被认领的缺口。

## Considered Options

- **补完 Known limits**：更便宜，但每条只是把天花板抬高一点，不产生新的使用场景。
- **扩受众**：Marketplace 1 装、Open VSX 668 下载、上游 1.6 M；代价是这段时间在写市场文案而
  不是代码，且外部 issue 会成为新的时间黑洞。
- **收债 + 收敛治理**：把 5 套搜索、4 套虚拟列表、3 套分页/失效收敛成一套，Excel 双栈定去留。
  买断后续成本，但产品表面零变化；本 ADR 把它降级为「按能力上收」。
- **先做筛选**：与「按窗口读」冲突的是分页语义（第 3 页是文件第 3 页还是结果第 3 页），需要先
  写一份 ADR；相比之下画像不改变分页。
- **先做排序**：与懒读正面冲突，377 MB 必须物化或外部排序。
- **先做两文件对比**：它不是列级能力，而是新的打开单位，与「一个文件一个 viewer」相撞。

## 后果

- **依赖里已经有原料**：`hyparquet` 自带 `pruningFilter`（按 row-group statistics 跳过行组）、
  行级 `filter`、`rowStart` / `rowEnd` 范围读，以及 offset index 与 bloom filter 支持。这既说明
  画像不必自己解析 thrift 统计，也说明**将来做筛选时缺的是接缝与 UI，不是算法**。
- **现有性能 fixture 测不到这件事**：`scripts/perf/fixtures.mjs` 里的两个 parquet 都是单 row group
  （`rowGroupSize: FLAT_ROWS` / `WIDE_ROWS`）、5 列、无 NULL、无 JSON 列。单行组下裁剪不成立
  （所有统计都来自同一组），所以本 ADR 的实现从新 fixture 开始：1M 行 / 10 组 / ZSTD / 含 NULL 的
  字符串列与 JSON 列，另加一个 `statistics: false` 的文件。实测 `hyparquet-writer` 支持多行组、
  `node:zlib` 的 ZSTD、bloom filter 与 column index —— 它只自带 SNAPPY，其余 codec 若不注入
  compressor 会把未压缩页标成目标 codec。**它写不出真正的 `LIST` 组**（数组列会被序列化成 JSON），
  所以嵌套列的覆盖留在 `test/fixtures/parquet/nested.parquet`。
- **新预算的逻辑是「零整份解码」**：在 377 MB / 1M 行的真实文件上，列画像 ≤ 2 s。但 CI 里的
  fixture 只有 4.3 MB，**整份解码也只要 1.5 s**——所以闸门不能只靠时间：主断言是「从 byte
  source 读出的字节数停留在 footer 量级」，时间与堆是辅助。否则一个偷偷解码整份的实现能在
  2 s 预算里过关。
- **与 `verify:perf` 进 CI 绑定**：新预算若不进 `main.yml`，就只在 tag 路径上跑，起不到护栏作用。
  代价是每次 push 多几分钟，且 fixture 要在 CI 里现生成（`.perf/` 不进 git）。
- **术语**：`GLOSSARY.md` 新增 Column profile / Non-goals / Known gaps 三个词。
- **不承诺**顺手消掉「全文件搜索 I/O 边界」。行组裁剪会改善它，但那条路要动的是搜索，不是画像。
- **放弃条件（写下来才可证伪）**：如果两个周末之后，metadata 接缝仍不能在 377 MB 文件上做到
  「零整份解码 + 列画像 ≤ 2 s」，则退回只补 Known gaps，不再往这一层投。
