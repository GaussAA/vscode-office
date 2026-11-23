# ADR-0030 JSONL/JSON：一个 120 字符摘要常量，一条全文通道

- 状态：已接受（2026-11-23，设计；实现已落地，见「实施记录」）
- 日期：2026-11-23
- 补充：[ADR-0022](./0022-visual-and-motion-direction.md) 的帧预算与动效规则；与 [ADR-0019](./0019-json-preview-command.md)
  的机身契约兼容

## 背景

`DESIGN.md` 早就写过「详情树的行只承担摘要，全文在停靠值面板里读」，但数字是散的，渲染路径有两套：

- **摘要有五套数**：树行字符串 120（`entryFormat.ts:68`，而且先对**整串** `JSON.stringify` 再切）、
  wrap 模式 2,000（`WRAP_TEXT_LIMIT`）、值面板收起行 160、左栏目录 raw 400（宿主下发）、搜索片段各自
  一套（±48 / 50–150）。
- **全文只有一个半通道**：值面板 200,000 字符（`JSONL_VALUE_TEXT_LIMIT`），超过只给提示 + 整值复制；
  错误行（`invalid` / `too-large`）不进面板，直接把最多 1,000,000 字符铺进 body。而每条详情消息**无条件**
  携带这份 `text`，即使当前只显示树。
- **渲染有两套**：`wrap` 模式（≤2,000 节点）走变高行 + 非虚拟列表，其余走固定行高虚拟列表——两套测量、
  两套路径；统一 120 之后折行几乎不发生，慢的那一套却还在。
- **实测**：1.5 MB 对象首次建树是一个约 437 ms 的长任务（`8e746882`）；值面板曾在 1.5 MB 值上卡住 webview
  （6.18.0 用 `jsonTextBounded` + 200k 上限缓解）；帧闸门目前只覆盖 parquet——ADR-0022 的「流畅可量」只落了一半。
- **搜索命中可能在摘要之外**：一条 40 KB 的 `content` 字段，命中落在第 3 万字符，树里什么都看不到。

维护者要求：默认只显示前固定的字符数，剩下的省略；完整内容通过值面板（口语里的「实况窗」）读；大文件也要
丝滑；动效在既有语言内打磨。

## 决定

### 1. 摘要只有一个数字：`SUMMARY_CHARS = 120`

- 常量放在 `src/common/recordConstants.ts`，替换 `RAW_PREVIEW_CHARS = 400` 与 `entryFormat.ts` 里写死的 120。
- 作用面：树行字符串、详情头标量、Raw 标签的默认正文、左栏目录标签（宿主下发同步 400 → 120）、搜索片段上限。
- 标记：截断处 `…` + muted `N chars`，复用现有 `wrappedText()` 的写法。
- **不得先 stringify 再截**：字符串摘要先按 120 个 code unit 切片再转义（或直接切原文），`chars` 计数仍取
  `.length`。1 MB 字符串的一行摘要不该分配 1 MB。

### 2. 删掉 wrap 模式

`WRAP_NODE_LIMIT`、`WRAP_TEXT_LIMIT`、`EntryModel.wrap`、`buildEntryModel` 的 `countNodes` 预扫描与非虚拟
渲染路径全部删除。所有条目固定 28px 行高、虚拟列表、单行摘要；换行只出现在值面板的正文里。收益是少一次
2,000 节点遍历、少一条渲染路径、少一组以「行高可变」为前提的测量与断言。

### 3. 值面板是唯一的全文通道

- **值条目**：任何被摘要截断的值都能在面板里读全文。正文按 `VALUE_PANEL_MAX_CHARS = 4,000,000` 字符硬预算，
  用 `jsonTextBounded` 构建（不整份分配），按行虚拟化（只把视口内的行放进 DOM）；超出预算时正文之前给一条
  截断说明。**复制始终是整值**（`jsonText`，不受预算约束）。
- **错误态也进面板**：`invalid` / `too-large` 的 body 默认只给 120 字符摘要 + 现有错误标签；面板给
  `entry.text`（≤ `MAX_TEXT_CHARS` = 1,000,000，沿用现有截断提示）。`readSelection` 的规则随之改为：值条目
  在无选中时指向整条记录（补上现在返回 `null` 的缺口），错误态直接给条目原文。
- **Raw 标签保留**：它是「看原始文本长什么样」的入口，默认 120 摘要；全文仍走面板。它不是第二个全文通道。
  值条目不再携带原文，这份摘要就是宿主下发的 `raw`；错误行的 `text` 仍随详情下发，因为面板要读它。
- **可展开**：停靠形态不变（撑高树、不遮树），新增「展开读」把面板临时铺满右栏高度；展开与开合都进帧闸门。
- 打开面板不再走无界 `JSON.stringify`；`EntryValuePanel` 不再用 `title` 承担动作名（`DESIGN.md` 已禁止）。

### 4. 搜索命中在摘要里可见

摘要以首个命中为中心：`…前文 [命中] 后文…`，总长仍 120 字符；无命中时照旧从头截。JSONL 详情树把
`highlight` 传给 `buildEntryModel`（现在只有 JSON 预览传）。左栏搜索结果片段保留自己的 ±上下文，但同样受
120 字符上限约束。

### 5. 详情消息不再携带原文

`jsonlEntryData` 与 JSON 记录消息不再携带原文：值条目的 `text` 恒为空，Raw 直接渲染宿主的 `raw`
摘要（≤120 字符），树只需要解析后的值。错误行是例外——它的文本就是内容、面板要读它，所以仍随详情
下发（≤1,000,000 字符）。省的是每条消息的构造、序列化与结构化克隆——正是「反复切条目」时的手感。

### 6. 帧闸门覆盖 JSONL 与 JSON

复用 `scripts/ui-verify` 的 rAF 采集器（`frames()` / `clearFrames()`），新增场景：`jsonl-frames-select`
（连续切 20 条）、`jsonl-frames-expand`（展开 dense 条目的 3 棵子树）、`jsonl-frames-panel`（打开
5,000 字符值的面板）、`json-preview-frames-record`（切 20 条记录）。阈值按 ADR-0022 的规则：先量基线，
天花板只允许收紧；与 parquet 的「1 gap ≤150 ms」同形。

### 7. 动效在 ADR-0022 的语言内

- 树展开 / 折叠**立即到终态**（不恢复 antd 动画）：2 万节点树上每次展开都要重排，帧闸门会把它抓住。
- 选中、悬停、搜索命中、值面板开合用 120–160 ms 令牌；`EntryDetail.tsx` 里硬编码的 `motion: true` /
  `0.15s` / `0.1s` 换成 `motionEnabled()` 与 `motion.ts` 的常量。
- `EntryShell.less:192,270`、`Jsonl.less:94` 等字面时长改为令牌，让 `prefers-reduced-motion: reduce`
  真正归零——目前全仓 28 处 `transition`、9 处 `animation`，只有 5 个 `prefers-reduced-motion` 块覆盖了
  其中一部分。

## Considered Options

- **每个面一套数字**（列表 80 / 树 120 / raw 400）：更贴各自的读法，但四套数字会在两次改动后漂移；
  维护者要的是一个数。否决。
- **做成设置项**：灵活，但多一条配置面、持久化与测试路径，且与本仓「门槛是常量不是设置项」的取向相反。否决。
- **保留 wrap 模式**：它是 2,000 字符时代的产品；统一 120 之后折行几乎不发生，却仍要维护变高行与非虚拟列表。
  否决。
- **值面板保留 200k 上限**：最省，但「值面板是唯一全文通道」与「长值可以读全」两条承诺会同时变成半句真话。
  否决。
- **不进帧闸门、靠截断自然变快**：截断减少每次渲染的字符数，减少不了树展开、面板 stringify、消息克隆这三处
  的主线程工作量。否决。

## 后果

- UI 场景：`jsonl-wrap-long-value` 与 `jsonl-heavy-entry-wraps` 删除（wrap 不存在了）；`jsonl-long-value-panel`
  的预览长度与字符数断言改写；`jsonl-truncation-is-visible` 与 `jsonl-too-large` 改为「body 120 + 面板原文」；
  `jsonl-big-entry-stays-single-line` 保留；新增 `jsonl-hit-centred-summary`、`jsonl-error-value-panel`、
  `jsonl-panel-expand`、`jsonl-frames-*`、`json-preview-frames-*`。
- 三份 README 的「长值可以读全，不是截断」改写为「摘要 120 字符；全文在值面板，最多 4,000,000 字符，
  复制始终是整值」；`PRODUCT.md` 与 `DESIGN.md` 的 Selection panel 一节同步重写（120 / 4M / 虚拟化 / 展开 /
  错误态）。
- i18n：`jsonl.valueTruncated` 的语义从「面板上限」扩展到「摘要与面板各自的上限」，新增摘要计数与「展开读」
  的 key；10 个 locale 文件（`en` + 9 个翻译）同步（未知 key 回退英文的机制不变）。
- 闸门：`docs/agents/perf.md` 增加 JSONL/JSON 的帧行；`verify:perf` 的 JSONL/JSON 字节预算不变。
- 已知边界：面板正文 4,000,000 字符；错误原文 1,000,000 字符；树 20,000 节点 / 每层 200 子项 / 12 层不变。
- 与 ADR-0022 的关系：不新增动效语言，只把「流畅」从 parquet 扩到另外两个面，并把绕过偏好的字面时长收编。

## 实施计划

本轮只落了设计文档（ADR、GLOSSARY 的 Summary / Value panel、`DESIGN.md` 的 Selection panel 一节、三份
README 与 `PRODUCT.md` 的对应段落）；代码不在本轮。下面 1–5 是实现提交，第 6 条的文档已经随本轮入库：

1. `feat(jsonl): one 120-character summary` —— `SUMMARY_CHARS` 常量、`preview()` 不整串 stringify、宿主 raw
   400 → 120、搜索片段套上限、删 `RAW_PREVIEW_CHARS`；单测覆盖切分、转义与计数。
2. `feat(jsonl): delete the wrap mode` —— 删 wrap 相关字段与分支、非虚拟路径，改写对应场景。
3. `feat(jsonl): the value panel is the only full-text channel` —— 4M 预算 + 行虚拟化 + 展开读 + 错误态接管 +
   根记录补位 + 值条目不再携带原文；单测与 UI 场景。
4. `perf(jsonl,json): frame budgets` —— 四个帧场景、基线数字、`docs/agents/perf.md`。
5. `polish(motion): tokens everywhere on JSONL/JSON` —— 字面时长与 `ConfigProvider` 硬编码收编，
   `prefers-reduced-motion` 断言。
6. `docs: the summary and value-panel contract` —— 本轮已写好的文档随这个提交入库，`CHANGELOG` 的
   `[Unreleased]` 补齐。

验收：`pnpm check:full` 全绿；帧场景的基线数字写在 `docs/agents/perf.md`，天花板在基线确认之后才设。

## 实施记录（2026-11-23）

- **摘要**：`SUMMARY_CHARS = 120` 进入 `recordConstants.ts`；`stringSummary()` 先按窗口切片再转义，不再
  对整串 `JSON.stringify`；宿主 raw（目录标签）与搜索片段同口径截到 120；`RAW_PREVIEW_CHARS` 删除。
- **wrap 模式**：`WRAP_NODE_LIMIT` / `WRAP_TEXT_LIMIT` / `EntryModel.wrap` / `countNodes` 与非虚拟渲染路径
  全部删除；树永远固定行高虚拟列表。
- **值面板**：`VALUE_PANEL_MAX_CHARS = 4,000,000`；`chunkText()` 把正文切成约 4,000 字符一块，块上
  `content-visibility: auto`（视口外的块不参与布局）——比「每行一个 DOM 节点」在 4M 字符下更省，也不会
  因为换行把行高算错；「展开读」把正文从 200px 拉到 70vh；`invalid` / `too-large` 的 body 变为 120 字符
  摘要，原文进面板；`readSelection` 对复合根补位，面板指向整条记录。
- **原文**：`jsonlEntryData` 与 `jsonRecord` 不再携带原文——值条目的 `text` 恒为空，Raw 直接渲染宿主的
  `raw` 摘要（120 字符）；错误行仍带原文（≤1,000,000 字符），因为面板要读它。
- **命中居中**：JSONL 详情树现在也接收 `highlight`，`buildEntryModel` 把摘要窗口移到首个命中；左栏片段
  同样受 120 上限约束。
- **帧闸门**：`jsonl-frames-select` / `jsonl-frames-expand` / `jsonl-frames-panel` /
  `json-preview-frames-record` 复用 parquet 的 rAF 采集器；本机 5 轮里 4 轮全 0 gap，1 轮记录到 1 个
  50 ms gap，天花板因此沿用「1 gap / 150 ms」。
- **动效**：`EntryShell.less` / `Entry.less` / `Jsonl.less` 的字面时长换成 `--motion-fast` /
  `--motion-base`（两个样式表补 `@import motion.less`，单测会查）；详情树的 antd token 改由
  `motionEnabled()` 与 `motion.ts` 常量驱动，树展开不恢复动画。
- **验收**：单测 671 通过（新增 summary / chunking / 命中居中 / 面板预算 / 空 wrap / lazy text 用例）；
  `verify:ui` 97/97；`verify:perf` 12/12；smoke 通过。
- **与设计的偏差（明说）**：面板用「分块 + `content-visibility`」而不是「每行 DOM 虚拟化」。原因是
  `pre-wrap` 下每行高度不定，按行虚拟化需要变速行测量；分块方案保持换行语义，且在 4M 字符下布局量与
  视口成正比。ADR 原文的「按行虚拟化」按此实现记录理解。
