# AGENTS.md

本文件是本仓库 agent 说明的唯一入口。细节按需读 `docs/` 下的文档，不要在这里堆长文。

## 这是什么

[cweijan/vscode-office](https://github.com/cweijan/vscode-office)（Office Viewer）的 fork，MIT。我们在上游基础上继续开发：补 zstd 压缩的 parquet、新增 JSONL 树视图。身份是 `chaowu21.office-viewer-plus`，与原版可共存。理由与后果见 [docs/adr/0001-fork-office-viewer.md](./docs/adr/0001-fork-office-viewer.md)。

## Agent skills

### Issue tracker

issue 与 spec 用 GitHub Issues，目标仓库是 fork `GaussAA/vscode-office`（`gh` 可能默认解析到上游，动手前先 `gh repo view --json nameWithOwner` 确认）。见 `docs/agents/issue-tracker.md`。

### Triage labels

默认五词：`needs-triage`、`needs-info`、`ready-for-agent`、`ready-for-human`、`wontfix`。见 `docs/agents/triage-labels.md`。

### UI verification

webview 的验收方式是无头浏览器断言 + 截图，见 docs/agents/ui-verify.md。

### Domain docs

单 context：根目录 `GLOSSARY.md` + `docs/adr/`。见 `docs/agents/domain.md`。

## 与上游的关系

我们**独立演进**：`upstream` 只是一个只读参考资料，不是合并来源。见 [docs/adr/0002-independent-evolution.md](./docs/adr/0002-independent-evolution.md)。

1. **需要上游的修复就读它的 diff，自己重写一遍**，不要 `git merge upstream/main`，也不要 rebase 到上游。`upstream` remote 保留，仅用于对照和可选的单点 `cherry-pick`。
2. **上游文件可以改写**。「能新增就不改写」不再是规则，取而代之的是：**一次改动只做一件事，且这个提交能单独回退**；不要把重构和功能混进同一个提交。
3. **继承来的债是我们的债**：上游代码的类型错误、死代码、残留配置都可以修。`pnpm typecheck` 的目标是零错误，不是给历史错误建永久白名单。
4. **风格**：上游的 4 空格 / 单引号不再有保护价值。统一到 prettier 要单独提交，不与功能改动混在一起。

## 代码结构（沿用上游布局）

重排本身不划算，不是因为对上游有承诺；要偏离布局先写 ADR。

- `src/extension.ts` / `src/extension.web.ts` —— 入口，注册全部 custom editors
- `src/provider/` —— 每个 viewer 一个 `CustomReadonlyEditorProvider`
- `src/react/view/<viewer>/` —— webview 内的 React 视图。解析器与组件分文件（如 `parquet/parquetParser.ts` + `parquet/Parquet.tsx`）
- `src/service/` —— 跨视图服务（如 `officeViewType.ts`、`csvService.ts`）
- `vite.config.ts` + `build.ts` —— 构建，产出 `out/`；webview 每个视图一个 Vite 入口
- `package.json` 的 `contributes.customEditors` —— viewer 与文件模式的唯一登记处

## 常用命令

```bash
pnpm install          # 依赖（pnpm，不是 npm）
pnpm build            # 构建到 out/（vite + esbuild 多步）
pnpm run package      # 打 vsix（@vscode/vsce 已是 devDependency；需先 build）
pnpm lint             # eslint 整个 src；0 problem 才通过
pnpm typecheck        # tsc 覆盖整个 src（含 webview）；基线现在是空的 = 零错误
pnpm typecheck:update # 重写基线 —— 审 diff，它只应变小
pnpm test             # node:test 单测（先 esbuild 打包纯逻辑模块）
pnpm test:smoke       # 集成 smoke：真实 VS Code 宿主里验证激活与 custom editor 路由（需先 build）
pnpm check            # lint + typecheck + test（pre-commit 跑这个）
pnpm check:full       # check + build + test:smoke + verify:ui（CI 跑这个）
pnpm verify:ui        # 无头浏览器验收：断言 DOM + 截图到 .ui-verify/shots（--docs 刷新 docs/screenshots）
```

**三层测试各管一件事**：`pnpm test` 管纯逻辑（不认识 `vscode`），`pnpm test:smoke` 管真实宿主里的激活与 custom editor 路由，`pnpm verify:ui` 管 webview 的 DOM。三者的失败模式不重叠——`verify:ui` 渲染的是 webview 的 HTML，它看不见「VS Code 有没有激活这个扩展」，所以升 `engines`、改激活事件、动 CSP 这类改动必须靠 smoke 兜。

**闸门是 fail-closed 的**：`scripts/typecheck.mjs` 把每个类型错误按「文件 + 错误码 + 消息」与 `scripts/typecheck-baseline.json` 比对，出现基线外的错误就红。基线已经清空（继承来的 75 条全部修掉），所以现在的规则很简单：**任何类型错误都会让构建失败**。不要用 `typecheck:update` 把新错误塞进基线 —— 那是这个闸门唯一能欺骗自己的方式。
