# ADR-0019 JSON 预览是命令式检查面，不是第四个 viewer

- 状态：已接受（2026-11-11，6.7.0）
- 日期：2026-11-11

## 背景

VS Code 对 `.json` 已经有一条原生路径：可编辑文本编辑器 + JSON 语言服务（折叠、格式化、schema 校验、补全）。按 `GLOSSARY.md` 的 **Native preview** 判据，这是“不装扩展也能顺手看”的格式，默认不该做第二份。

但维护者的真实工作里出现了另一类文件：API/导出产出的 **10–100 MB、minified 的顶层数组**。它们不是拿来编辑的，而是拿来读结构、找某个值、确认某个字段；原生编辑器在这件事上滚动和定位都很吃力（首屏长、折叠状态不保留、搜索只给文本位置）。

现有 JSONL viewer 已经证明了一套适合读结构的机身：可拖 Splitter、虚拟目录、详情树、停靠值面板、全文件搜索、全键盘。把同一套机身对准一个 JSON 顶层数组，可以在不改 `.json` 默认编辑器的前提下补上这个缺口。

产品约束也不能忽略：`PRODUCT.md` 把格式集合封在三个 Viewer，`ADR-0015` 要求新增格式先证明“原生没有、且我每周都在开”。JSON 的原生能力是**编辑**，不是大数组的**阅读**；这条差异是本 ADR 的立足点，而不是“原生支持得不够好”的主观判断。

## 决定

JSON 预览以**显式命令**打开，**不注册为 Viewer**：

- 不写 `contributes.customEditors`，不注册 `.json` 文件选择器，不接管默认双击；`.json` 仍然由 VS Code 文本编辑器打开。
- 入口三处：命令面板（`Data File Viewer: Preview JSON`）、资源管理器右键、JSON 编辑器标题。
- 只读 webview 面板；保留“Open in Text Editor”。编辑器有未保存修改时读编辑器 buffer，并标明来源。
- 顶层数组：流式扫描记录边界，建立记录索引；10–100 MB 不整份 `JSON.parse`；左栏是虚拟记录列表（`[index]` + 身份标签，无身份回退原始 JSON 头），右栏是选中记录的树和底栏值面板；复用 JSONL 的 Splitter、树、值面板与键盘。
- 对象根：整份解析，上限 20 MB；超过显示 too-large 并给文本编辑器出口。
- 全文件记录级搜索：结果替换左栏，带片段与命中数；选中记录后树展开并高亮首个命中；`Esc`/清空恢复记录列表。
- 严格 JSON。注释/尾逗号不做兼容；解析错误给行/列与文本编辑器出口。
- 顶层数组超过 100 MB 或对象根超过 20 MB：too-large，不尝试加载。
- 实现细节：记录标签按可见窗口向宿主请求（每窗 100 条，宿主只解析返回的记录）；单条记录超过
  8 MB 按原文显示，原文最多 1,000,000 字符；搜索最多 10,000 个命中；对象根搜索在 webview 内
  算路径；面板不恢复上一次预览的文档（命令式面板没有 serializer），左栏宽度按文件持久化。

## Considered Options

- **第四个只读 viewer，opt-in**（`priority: option`）：可在“打开方式”里选，但会改变 `contributes.customEditors`、产品名/三份 README/Release 的格式集合，仍然是一次格式接管范围的扩张；本轮没有选。
- **第四个 viewer，默认接管**：双击 `.json` 就进树，直接牺牲编辑、补全、格式化和 schema 校验；对配置文件是伤害，否决。
- **不做**：守住 Native preview 去重，但 10–100 MB/minified 数组的阅读缺口仍在；用户明确要做，否决。
- **命令式检查面**（本 ADR）：不改默认编辑器、不进入格式集合；代价是入口比双击隐蔽，需要三处菜单 + 命令确保可发现。

## 后果

- 新增一个命令、一个 webview panel 入口和 `main.tsx` 的 `case "json"`；没有新增 Vite 入口（仍是唯一的 `index.html`），`contributes.customEditors` 不变。产品名仍是 `Data File Viewer (Parquet, JSONL, Excel)`。
- 宿主需要一套顶层数组扫描/索引（记录边界、字节偏移、严格 JSON 错误）、按记录解析、全文件记录搜索和对象根整份解析；这些逻辑放在 `src/service`，不放进 webview。
- 100 MB 数组的首屏/索引/搜索需要新的性能闸门；不能用“小文件能跑”验收。
- 不支持 JSONC、编辑、schema 校验；对象根 20 MB 上限、数组 100 MB 上限是明说的 Known limits。
- 发现性低于双击；三处入口和 README 必须写清楚“它不替代编辑器”。
- 测试面增加：扫描器/索引单测、webview UI 场景、真实宿主命令 smoke、100 MB 性能预算。
- 与 `ADR-0015` 的“不再扩展”不冲突：扩展的是**检查命令**，不是 Viewer 的格式集合；但以后若要把 JSON 变成第四个 viewer，仍需另写 ADR。

## 实现结果（6.7.0）

- 100 MB 数组 fixture（91.6 MB、50,000 条记录）在宿主侧测得：索引 0.49–1.37 s、100 条记录窗口 1–3 ms、单条详情 <1 ms、全文件搜索 63–114 ms；闸门预算分别为 6 s / 2 s / 8 s。
- UI 场景覆盖记录列表虚拟化（500 条记录时 DOM <100 行）、记录搜索高亮、对象根路径搜索、buffer 标签、invalid / too-large / 空数组；真实 VS Code smoke 覆盖命令打开 webview 面板，并断言 `.json` 没有 custom editor 声明。
- JSON 的 tree/value panel/keyboard 复用 `JsonlDetail`，只给它加了可选的 `entryLabel`、`highlight`、`revealKey`；JSONL 的既有场景保持通过。
