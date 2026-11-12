---
status: accepted
---

# 功能边界：只留下这个 fork 真正要负责的东西

继承来的代码里有三块东西，性质各不相同，但都是「我们在替别人维护一份更差的拷贝」或者「我们继承了一个没人管的面」：

**1. `.http` REST client（`src/provider/http/`，49 文件 / 4,072 行）** 分叉自 [`Huachao/vscode-restclient`](https://github.com/Huachao/vscode-restclient) —— 同一套 `$timestamp` / `$processEnv` 变量词汇、同一个 `rest-client-response` scheme、同样的 `providers/` + `controllers/` 布局。而那个上游**仍在活跃维护**。它带着一整条贡献链：1 个语言定义、1 份 42 KB 语法、1 份 snippet、2 个命令、4 处菜单、`ctrl+enter` 键位、`activationEvents: onLanguage:http`，以及 `contributes.configuration` 里 **9 个**「HTTP Client」设置项。

**2. AI polish（`src/service/ai/`，2 文件 / ~16 KB；客户端 320 行）** 支持 OpenAI / Anthropic / Gemini / 自定义四种格式的流式调用。但 `package.json` 里**没有任何 AI 相关设置** —— 端点与密钥由 webview 传进来，然后把整篇文档发出去。CSP 没被削弱（`connect-src` 只允许 `cspSource`，请求走扩展宿主的 `fetch`），这恰恰说明它是绕开我们所有安全边界单独生长出来的一块。

**3. 五份语法 + 两个配色主题 + 一个图标主题** —— `syntaxes/` 12 文件 175 KB 里，只有 `.http` 那份服务于我们自己的功能；`nginx` / `kotlin` / `toml` / `kusto` / `reg` 服务的是别人的文件类型。`theme/onedark-modern.json`（60 KB）与 `--classic`（45 KB）是两个流行配色主题的拷贝。`theme/material-icons.json`（573 KB）引用了 `icons/` 下 1263 个 SVG，是 `PKief.material-icon-theme` 的快照。

决策：

- **删掉 `.http` client 整个功能**。理由不是「不好」，而是它的上游还活着 —— 我们每维护它一小时，就是在维护一个更差的别人的产品。**不换成 `httpyac`**：那个库最后一次发布是 2025-03-30，用它替换等于从「自研的死分叉」换成「依赖一个将死的库」，两者都不如直接不提供。
- **删掉 AI polish**。320 行客户端、四种协议、零个声明的设置、一个无人拥有的对外发送面。
- **删掉那五份语法与两个配色主题**；**重写图标主题**为只覆盖我们会渲染的格式的最小集（最终 8 个图标，而不是 1263 个 SVG 拷贝）。
- **git history 保留但换引擎**：手写的 porcelain（`commitService.ts` 单文件 877 行，全部 2,355 行）换成 `simple-git`。同时把「跟 git 说话的正统路径」钉死：**仓库事实（状态、远端、HEAD）走 VS Code 内置 Git 扩展的 `getAPI(1)`**（`officeContent.ts` 已经这么做了），**只有它答不了的提交图查询才走 `simple-git`**。在此之前这个仓库同时用两种方式跟 git 说话，而手写的那一半零单测。

## Considered Options

- **全部保留，只做依赖升级**：那这次改造就只是给厨房水槽换水龙头。
- **`.http` 换成 `httpyac`**：见上，且它解决的是「谁来维护」，不是「我们该不该提供」。
- **gitHistory 也一并删掉**：它是这个扩展里唯一能在 VS Code 内看提交图的东西，且 GitLens 已经覆盖得更好 —— 但它同时是我们唯一还在跑自己 git 代码的地方，删掉的收益（2,355 行）小于换引擎后的留存价值。**换引擎，不删功能。**

## Consequences

- 这是**功能移除**，不是重构。`CHANGELOG.md` 必须逐条列出，`README` 的「不支持」一节要更新。
- 扩展的自我描述收窄成「文档/格式预览器」：parquet、jsonl、office 文档、存档、字体、图片、Markdown、Git 历史。
- 审计里把 `src/provider/yaml`（278 行）与 `src/provider/xml`（71 行）也标成了「语言服务 fork」—— **这是错的，保留它们**：两者注册的 document selector 是 `[{ language: 'yaml' | 'xml', scheme: '*' }]`，服务的是任意 YAML/XML 文件，不是 `.http` 的附属。它们的 `xmlFormat.ts`（577 字节的手写 XML 格式化器）另算，属于依赖替换批的候选。
- 删除之后 `activationEvents` 里 `onLanguage:http` 消失，只剩 `workspaceContains:.git/HEAD` 与 `onWebviewPanel:office-git-history` 两条真正需要的。
- **后续**：Git 历史在 6.8.0 删除后，`activationEvents` 只剩 `onCommand:GaussAA.office.previewJson` 一条，`package.json` 是唯一事实来源。
- **AI 的删除分两半，第二半还没做。** 扩展侧（`src/service/ai/`、provider 的 4 个 handler 与 4 个方法、webview 的菜单项与 `ai-i18n.js`、5 个 l10n 键）已全部移除，`ai` 选项与 `onPolish` 回调不再传给 vditor —— 也就是说**没有任何代码路径能把文档发出去**。但 `vditor/` 内部仍留着 `ui/aiDialog.ts`（36 KB）、`toolbar/AISettings.ts`（12.6 KB）与 `ts/ai/`：它们现在是惰性的（`mergedOptions.ai?.onPolish` 为空，对话框不会创建），且这份 fork 的 Markdown 编辑器此前没有任何自动化 DOM 覆盖。**先把覆盖面补上，再删**——本次顺手新增的 `markdown-editor` 场景就是那步的前置。
