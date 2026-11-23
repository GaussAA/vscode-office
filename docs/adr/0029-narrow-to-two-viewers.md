# ADR-0029 收窄到两个 viewer：表格预览整体删除

- 状态：已接受（2026-11-23，设计；实现已落地，见「实施记录」）
- 日期：2026-11-23
- 取代：[ADR-0015](./0015-narrow-to-three-viewers.md) 的「三种格式」范围；[ADR-0016](./0016-preview-size-guard.md)、
  [ADR-0017](./0017-windowed-spreadsheet.md)、[ADR-0024](./0024-keep-x-spreadsheet-with-optimization.md)、
  [ADR-0027](./0027-excel-workbook-host-cache.md) 与 [ADR-0028](./0028-csv-offsets-and-json-preview-index.md)
  中表格相关的裁决

## 背景

6.0.0 把继承来的十一种格式收窄到三种：表格、parquet、JSONL（ADR-0015）。此后表格一直是这个仓库里最贵的一块，
而且不是维护者每天在用的那一块：

- 它是三种 viewer 里**唯一的可编辑面**：`src/react/view/excel/` 192 个文件（49 个自写文件约 8.3k 行 +
  143 个 vendored `x-spreadsheet` 约 14.7k 行）、6 个宿主文件、两套磁盘缓存（CSV 偏移、工作簿解析）、
  一条保存回写通道、15/25/350 MB 三道体积闸门、33 个单测、17 个 UI 场景、1 条性能不变量，以及
  `xlsx`、`iconv-lite`、`dompurify` 三个只为它存在的依赖。
- 维护者实际读的是 parquet（ZSTD）、JSONL/NDJSON 与命令式 JSON 检查——这三个面都是只读的。表格的编辑能力
  没有被用过，它带来的却是整个扩展里唯一一条写文件的路径（`saveHandlers` 与脏标记）。
- 表格也是产品名里唯一出现「Excel」的原因；而 `.xlsx/.xlsm/.xls/.ods` 在 VS Code 里没有原生预览路径
  （ADR-0016 的后果已经写明）。所以删掉它等于承认「这个格式我们不做」，而不是「交给宿主」。

这次的判据不是 ADR-0014 的 **Native preview**（那一轮砍的是「原生已经够用」的格式），而是**维护面与使用面
不成比例**：一个只有维护者之外的人才可能用、却占了这个仓库近一半代码与全部写入风险的面。删掉之后扩展第一次
与它的产品名一致：两件只读仪器（parquet、JSONL）加一个命令式检查探头（JSON，ADR-0019 不变）。

## 决定

1. **删除整个表格预览面**：`GaussAA.officeViewer` 注册、`officeViewerProvider` 的表格分支、
   `excelCsvHost` / `excelWorkbookHost`、`saveHandlers`（保存与脏标记）、`CsvIndexCache` / `ExcelWorkbookCache`、
   `csvService` 与 `GaussAA.office.csv.switch` 命令、`src/react/view/excel/**`（含 vendored `x-spreadsheet`）、
   表格专属的 `common` 模块（`csvIndex`、`excelWorkbook`、`workbookRows`、`saveContent`、`columnLabel`、
   `fileSuffix`）与 `previewLimit` 的表格部分。判据是「只有表格能到」；共享模块（`hostDiskCache`、
   `entryClassifier`、`documentSource`、`dataViewerCacheClear`、`officeContent` 的通用部分）保留。
2. **保留两个 viewer**：parquet 与 JSONL/NDJSON。命令式 JSON 检查器（ADR-0019）与两文件对比预览
   （ADR-0021，属于 parquet）都不变。
3. **扩展从此没有可编辑面**：没有保存路径、没有编辑态、没有脏标记。`GLOSSARY.md` 的 Editable surface 术语
   删除，由 Read-only preview 取代；「只读」从一种选择变成全部承诺。
4. **顺带保留的两块不是表格**：YAML/XML 语言服务（不是预览，也不是写操作）与 Material 图标主题
   （展示层；它给 `.xlsx/.csv` 配的图标仍然有用——文件在资源管理器里一眼能认出来，与谁预览无关）。
   它们若要再收窄，另开 ADR。
5. **产品名改为 `Data File Viewer (Parquet, JSONL)`**，下一次发布是 **7.0.0**（major，因为删了一个 viewer）。
   版本号与发布流程不在本 ADR 内落地；`docs/agents/release.md` 增加第三个产品名年代。
6. **格式集合仍然关闭**：删除格式不需要新判据，「不再新增 viewer」不变；JSON 仍是命令式检查器，不是
   viewer。

## Considered Options

- **只取消注册、代码留树**：改动小、回退快；但 192 个文件会继续参与 lint/typecheck/构建与每次审计，
  并以「幽灵功能」的形式误导下一个人。否决。
- **保留表格但冻结为只读**：省不下 `xlsx`、`x-spreadsheet`、窗口表与两套缓存；「只读」不减少依赖，
  只减少一条保存路径。否决。
- **拆成独立扩展**：更彻底，但多一条发布流水线、一份 webview 构建与一份 Marketplace 条目；只有一个人维护时
  成本高于收益（ADR-0015 已用同一理由否过一次）。否决。
- **继续留着、只是不用**：这正是 6.0.0 之后的实际状态；`x-spreadsheet` 是 ADR-0024 明确认领的 vendored 债，
  而维护者已经不再打开表格文件。否决。
- **硬删（本 ADR）**：代价是 `.xlsx` 用户失去预览（本来也没有原生替代），收益是约 23k 行与三个依赖离场。
  这是唯一让「只保留真正会用的格式」这句话成立的走法。

## 后果

- `contributes.customEditors` 从 3 个 viewType 降到 2 个；`GaussAA.officeViewer` 的 8 条 `filenamePattern`
  与 `GaussAA.office.csv.switch` 命令/菜单消失；`activationEvents` 不变（本来就只有 `previewJson` 与
  `compareParquet`）。
- 依赖删除：`xlsx`、`iconv-lite`、`dompurify`（+ devDependency `@types/dompurify`）、今天就已无人引用的
  `jszip`；`vite.config.ts` 的 `optimizeDeps.exclude: ["xlsx"]`、`vendor-xlsx` 手写 chunk 与
  `src/react/polyfills/buffer.ts` 一并删除（`buffer` 只有在构建后确认无人使用才从依赖里删）。
  `.oxlintrc.json` 里 `src/react/view/excel/x-spreadsheet/**` 的 `ignorePatterns` 必须删——否则配置在为一个
  不存在的目录保留例外。
- 闸门：`verify:perf` 删掉 `sheet-window-first-paint` 与它的 CSV fixture/路由，不变量条数减一；
  `verify:ui` 删掉 17 个表格场景与 `excel-motion`，`remaining-routes-smoke` 的路由列表变空（场景要么删除、
  要么改成断言「没有 excel 路由」）；`test:smoke` 删掉 `saveHostSuite`、`hostCache.test` 的 CSV/工作簿两段
  与 `extension.test` 的 `GaussAA.officeViewer` 用例；`viewer-registry.test` 的双向钉住关系随之更新——
  ADR-0014 警告过：注册、贡献与 UI 路由三处必须一起改。
- 产物：`test/fixtures/spreadsheet/*`、`test/fixtures/test-simple.xlsx`、`test/fixtures/workspace/sample.csv`、
  `scripts/create-test-excel.mjs`、`docs/screenshots/excel-*.png`（4 张）。`icons/table.svg` 与
  `theme/material-icons.json` 里 `.xls/.xlsx/.xlsm/.csv/.tsv/.ods` 的图标映射**保留**（见决定 4）。
- 文档：三份 README、`PRODUCT.md`、`DESIGN.md`、`AGENTS.md`、`NOTICE.md`、`docs/agents/release.md`、
  `docs/agents/perf.md`、`docs/agents/ui-verify.md`、`CONTRIBUTING.md` 的 `excel`/`csv` 标签说明，
  以及发布相关的 `.impeccable/design.json`、`.github/workflows/release.yml`。`CHANGELOG.md` 只允许在
  `[Unreleased]` 里追加，历史小节不改写。`NOTICE.md` 里的 `x-spreadsheet` 署名行属于*代码*的归属，必须
  在代码真正删除的同一个提交里移除，不能提前删、也不能留在树里。
- 发布：6.x 的 Release 标题与产品名是历史事实，不改写；7.0.0 起用新名（`release.md` 增加第三个年代）。
- 用户可见的缺口：`.xlsx/.xlsm/.xls/.ods` 不再有预览；`.csv/.tsv` 回到 VS Code 文本编辑器（ADR-0016 已确认
  那是可用路径）。这两句必须写进三份 README 的「已知缺口」，而不是留给用户自己发现。

## 实施计划

本轮只落了设计文档（ADR、GLOSSARY、DESIGN、PRODUCT、三份 README、AGENTS、NOTICE、release/perf/ui-verify
文档，以及 `package.json` 的显示名/描述/关键词）；**代码、`contributes`、依赖与闸门改动都不在本轮**。
下面三个提交把它们补齐，每个提交都能单独回退且 `pnpm check` 绿：

1. `test: drop the spreadsheet suites` —— 删 33 个表格单测、17 个 UI 场景与 `excel-motion`、smoke 的
   `saveHostSuite` 与 `hostCache` 的表格段、perf 的 `sheet-window-first-paint` 与 CSV fixture；改
   `viewer-registry.test`、`ui-verify/scenarios/other.mjs` 的路由列表、`fixtures.test` 的 CSV 段、
   `preview-limit.test` 与 `data-viewer-cache-clear.test`。此时实现还在，但没有任何断言依赖它。
2. `feat!: remove the spreadsheet viewer` —— 删宿主与 webview 实现、依赖、构建配置、测试 fixture；
   `officeViewerProvider` 只留 parquet，`commonHandler` 只留共享 handler；`package.json` 的
   contributions/commands/menus 与剩余依赖一起改（显示名/描述/关键词已在设计提交里改好）。
3. `docs: narrow the product to parquet and JSONL` —— 本轮已写好的文档随这个提交入库，并删掉 4 张表格截图；
   `CHANGELOG` 的 `[Unreleased]` 写 `### Removed`（逐条列格式与机制）与 `### Changed`（产品名）。

验收：`pnpm check:full`（lint / baseline / typecheck / self-test / 单测 / smoke / UI / perf）在真实宿主与
无头浏览器里全绿；`pnpm run package` 的产物里不再有表格 chunk。7.0.0 的版本号与发布另起一次提交。

## 实施记录（2026-11-23）

- **删除 258 个文件**：`src/react/view/excel/**` 192、宿主 6、`src/common` 6、死掉的 webview 模块 4
  （`htmlSanitizer`、`FileTypeIcon`、`fileIcon`、`buffer` polyfill）、单测 33、smoke 1、脚本 2、
  fixture 10、截图 4。
- **依赖**：`xlsx`、`iconv-lite`、`dompurify`、`jszip`、`buffer`、`@types/dompurify`，外加只被已删
  html-sanitizer 测试使用的 `jsdom` / `@types/jsdom`。
- **闸门**：`pnpm check`（format / lint / 基线 / typecheck / self-test / 单测 671）通过；`pnpm build`
  不再产出表格 chunk；`verify:ui` 97/97；`verify:perf` 12/12；`pnpm test:smoke` 通过。
- **本机环境修正**：TypeScript 7.0.2（原生编译器）不再自动加载 `@types`，`tsconfig.json` 显式声明
  `"types": ["node", "mocha"]`；这是「零基线」在本机能成立的前提，不是放宽闸门。
- **仍未做**：版本号与 7.0.0 发布（按本 ADR 留给发布轮次）。
