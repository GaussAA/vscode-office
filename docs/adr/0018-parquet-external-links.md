# ADR-0018 Parquet URL 单元格只在宿主打开 http(s)

- 状态：已采纳
- 日期：2026-11-10

## 背景

parquet 里的 URL 通常只是 `STRING`，例如 Hugging Face 数据集的 `url` 列。用户希望在预览里直接点开，但 webview 的内容来自文件，不能信任；`javascript:`、`data:`、`file:` 或带 userinfo 的地址都不应该交给操作系统。

## 决定

单元格的**值**是完整 `http(s)` URL 时，它才显示为链接。点击/回车只发出 `openExternal` 消息，由宿主 `commonHandler` 再次校验后调用 `vscode.env.openExternal`；webview 不直接导航。校验在 `src/common/externalLink.ts` 中只实现一次：只允许 `http:` / `https:`，拒绝 userinfo、控制字符和超长值。

直接单击打开，不加确认弹窗；点击本身就是明确意图。列名不参与识别，`description` 里夹带的 URL 也不会被整段变成链接。

## 后果

- 任意 URL 形状的列（不只叫 `url`）都能得到链接，但列类型仍然显示为 `STRING`。
- 如果以后需要支持 `mailto:` 等协议，必须同时改 webview 与宿主的白名单，而不是只改 UI。
- 在 webview 里点击链接不会被 CSP 或 iframe 当作导航；打开动作始终经过宿主。
