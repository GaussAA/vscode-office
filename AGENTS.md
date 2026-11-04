# AGENTS.md

本文件是本仓库 agent 说明的唯一入口。细节按需读 `docs/` 下的文档，不要在这里堆长文。

## 这是什么

[cweijan/vscode-office](https://github.com/cweijan/vscode-office)（Office Viewer）的 fork，MIT。我们在上游基础上继续开发：补 zstd 压缩的 parquet、新增 JSONL 树视图。身份是 `chaowu21.office-viewer-plus`，与原版可共存。理由与后果见 [docs/adr/0001-fork-office-viewer.md](./docs/adr/0001-fork-office-viewer.md)。

## Agent skills

### Issue tracker

issue 与 spec 以本地 markdown 记在 `.scratch/<feature-slug>/` 下，无远程 tracker。见 `docs/agents/issue-tracker.md`。

### Triage labels

默认五词：`needs-triage`、`needs-info`、`ready-for-agent`、`ready-for-human`、`wontfix`。见 `docs/agents/triage-labels.md`。

### Domain docs

单 context：根目录 `GLOSSARY.md` + `docs/adr/`。见 `docs/agents/domain.md`。

## 代码结构（上游布局，勿重排）

- `src/extension.ts` / `src/extension.web.ts` —— 入口，注册全部 custom editors
- `src/provider/` —— 每个 viewer 一个 `CustomReadonlyEditorProvider`
- `src/react/view/<viewer>/` —— webview 内的 React 视图。解析器与组件分文件（如 `parquet/parquetParser.ts` + `parquet/Parquet.tsx`）
- `src/service/` —— 跨视图服务（如 `officeViewType.ts`、`csvService.ts`）
- `vite.config.ts` + `build.ts` —— 构建，产出 `out/`；webview 每个视图一个 Vite 入口
- `package.json` 的 `contributes.customEditors` —— viewer 与文件模式的唯一登记处

## 与上游共存的铁律

1. **不改上游文件的风格**（4 空格缩进、单引号）。`.prettierrc` 只作用于我们自己的根级文档，`src/` 不参与自动格式化。
2. **能新增就不改写**：改动集中在新文件或上游的少数接缝（`parquetParser.ts`、`extension.ts`、`package.json`），以便 `git merge upstream/main`。
3. **不要 rebase 到上游**，方向永远是 upstream → 我们。

## 常用命令

```bash
pnpm install     # 依赖（pnpm，不是 npm）
pnpm build       # vite 构建到 out/
pnpm run package # vsce 打包 vsix（需先 build）
```
