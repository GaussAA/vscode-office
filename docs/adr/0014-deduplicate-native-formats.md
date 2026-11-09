---
status: accepted
---

# 去重：原生能顺手看懂的格式，我们不保留第二份实现

判据只有一条：**不装任何第三方扩展时，VS Code 自己能不能顺手看到这个格式的内容**。能，就把呈现权交还宿主；不能，才是我们要负责的地方。

「成熟」的操作定义是「存在一条不装扩展就能用的顺手查看路径」，不看是否默认双击，也不看有没有人写过插件——Markdown 的预览是命令级的（`Ctrl+Shift+V`），照样算成熟。这条判据同时管三件事：

- **新增格式**：只做原生做不到的（zstd parquet、JSONL 树是这条线的产物）。
- **既有格式**：与原生重复的部分删掉，不因为「历史上有过」而保留。
- **边界**：判据只看「有没有」，不看「差多少」。质量差异只用来决定删除的**顺序**，不用来决定删不删。

本轮落地的删除：

- **Markdown 编辑器**（`GaussAA.markdownViewer`）整块删除：`vditor/` workspace 包（19.0 MB / 319 文件）、`resource/markdown`（9.9 MB / 63 文件）、扩展侧 2,246 行的 provider/service/wikilink 链、PDF/DOCX/HTML 导出（puppeteer 系）、9 个设置项、`Ctrl+V` 抢占与 `Ctrl+Alt+E` 切换命令，以及它们的单测与 UI 场景。
- **parquet 的编辑面**：删写端（`hyparquet-writer` 的运行时引用移出 `dependencies`），保留查看、分页、搜索、schema、嵌套列。这一条不是去重，而是「我们的 parquet 只负责读」——写端来自上游，且自带三条坑（非 SNAPPY 保存会被重写成 SNAPPY、超 20 万行只读、保存需要整份重读）。

三处边界，逐条记录裁决：

- **SVG**：原生图片预览默认就渲染 `.svg`，并提供 `reopenAsText`。按判据应删；我们那 922 行工具箱（格式化、改色、导 PNG、代码编辑）全是写侧能力，删掉不损失「看」。**本轮没有执行**——它是 6 个独占 CodeMirror 依赖的宿主，单独一个提交，确认后再删。
- **HTML 保留**：原生只有面板级入口（Simple Browser / Integrated Browser），没有与文件类型关联的预览，双击 `.html` 仍是文本编辑器。我们的 `htmlViewer` 是 `option` 级、不抢默认，是当前唯一「在编辑器里看 HTML」的路径。等宿主把 HTML 预览关联到文件类型，这条再复议。
- **imageViewer 暂不动**：它的 11 条模式里 9 条原生已支持，但 `priority: option` 意味着不抢默认打开；且 `handleImage` 与 `tiff`/`heic`（原生不支持）共用，拆它等于同时去掉两个真实缺口。列为下一轮独立提交。

## Considered Options

- **只做「不再新增重复实现」，不动存量**：那这个扩展会永久背着 30 MB 资产与 19 个依赖，为一份原生已合格的 Markdown 预览付维护费。
- **保留 Markdown 但只读**：仍然是一份第二实现，只是去掉了写能力；判据看的是「有没有」，不是「写不写」。
- **按「谁写的代码」决定去留**：这个判据在 parquet 上会失效——它的写端同样来自上游，但我们仍要删；它还会让 `.http`、主题那类真正的继承债失去统一口径。

## Consequences

- **6.0.0**。这是功能移除：Markdown 编辑器、PDF/DOCX/HTML 导出、parquet 保存从产品里消失。`CHANGELOG.md` 必须逐条列，三份 README 的格式清单与「不支持」一节重写。
- **依赖面第一次真正收缩**：Markdown 的 19 个独占依赖、`puppeteer-core` / `chrome-launcher` / `@puppeteer/browsers` / `vscode-html-to-docx`，以及 `vditor/` 这个独立 workspace 包一起离开。`pnpm-workspace.yaml`、`vite/vditorPlugin.ts`、`.vscodeignore`、`.oxfmtrc.json` 里的 vditor 例外同步删除。
- **闸门会红，而且有一部分不会自己变红**：`viewer-registry.test.ts` 双向钉死注册，删除必须同步；孤儿 i18n 键、孤儿图标键、扩展侧 l10n、README 清单都不在自动闸门的覆盖里（见 ADR-0011 与审计报告），要逐项手动扫。
- 删除之后这个扩展的自我描述收窄成「只读格式查看器」，仓库里不再有子 workspace 包。
