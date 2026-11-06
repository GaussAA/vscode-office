# ADR-0005 Webview 的 CSP

- 状态：已采纳
- 日期：2026-11-06
- 相关：[ADR-0003 平台基线](./0003-platform-baseline.md)

## 背景

八个 viewer 共用同一份 webview 外壳（`index.html` + `ReactApp.view`）。此前它**没有**
Content-Security-Policy，等于把「加载什么」完全交给运行时：任何被塞进文档的字符串，只要能
变成 `<script>`，就能执行；任何远程地址都可以被请求。

VS Code 官方建议 webview 设置 CSP，并用 `webview.cspSource` 而不是 `*` 作为来源。

## 决定

`src/common/webviewCsp.ts` 生成策略，`ReactApp.view` 注入到 `index.html` 的
`{{csp}}` 占位符；`markdownEditorProvider` 用同一函数注入到 Markdown 编辑器外壳。

```
default-src 'none';
script-src ${cspSource} 'wasm-unsafe-eval';
style-src ${cspSource} 'unsafe-inline';
img-src ${cspSource} data: blob:;
font-src ${cspSource} data:;
media-src ${cspSource} data: blob:;
frame-src ${cspSource} data: blob:;
connect-src ${cspSource} data: blob:;
worker-src ${cspSource} blob:
```

三个例外各有明确理由：

- `style-src 'unsafe-inline'` —— antd 是 CSS-in-JS，运行时注入 `<style>`。没有它，八个
  viewer **全部**白屏（已验证：删掉这一项，13 条验收全部失败）。
- `script-src 'wasm-unsafe-eval'` —— font viewer 的 woff2 解压器是 Emscripten 模块。
- `frame-src` / `data:` / `blob:` —— EPUB 用 iframe；图片转换、压缩包条目、分片读取走的
  都是 blob / data URL。

## 后果

- 远程脚本、内联脚本、`eval`、任意外部请求从此被阻断。`'unsafe-eval'` **没有**加入：epubjs
  自带一个 `globalThis` 探测（`new Function("return this")`，包在 try/catch 里、失败退回
  `window`），它在 CSP 下必然报一条 violation 但无害。`verify:ui` 精确过滤这一类
  `EvalError`，其余 violation 一律判定失败 —— 这比为了一个探测给所有 viewer 打开 `eval`
  要好。
- **HTML 预览面板不受此策略管辖**。它是 `iframe srcdoc`，会继承嵌入方的策略；加 `script-src`
  等于把用户想预览的页面本身拦掉。该面板用 iframe 的 `sandbox` 隔离，见
  `src/service/htmlPreviewShell.ts`。
- 这条策略不是只写在文档里：`verify:ui` 每条场景结束都断言「本场景没有 CSP violation」，
  失败信息直接给出被拦的指令。负向验证做过一次：删掉 `style-src` 的 `'unsafe-inline'`，
  13/13 全部失败。
