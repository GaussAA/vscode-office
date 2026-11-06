# ADR-0006 发布者身份改为 `GaussAA`

- 状态：已采纳
- 日期：2026-11-06
- 相关：[ADR-0001 fork 身份](./0001-fork-office-viewer.md)、[ADR-0002 独立演进](./0002-independent-evolution.md)

## 背景

fork 最初的身份是 `chaowu21.office-viewer-plus`，其中 `chaowu21` 是本机账户名，不是任何公开身份。
GitHub 账号是 `GaussAA`，仓库也是 `github.com/GaussAA/vscode-office`。

扩展的 `publisher` 决定 URL、安装 ID（`code --install-extension <publisher>.<name>`）、以及
Marketplace 上的所有权归属；它与代码托管身份不一致时，用户无法从仓库反查发布者。

## 决定

发布者一律使用 **`GaussAA`**，与 GitHub 账号一致：

- `package.json` 的 `publisher`：`GaussAA`
- 所有命令 ID、custom editor 的 `viewType`、webview panel 的 viewType 前缀：
  `chaowu21.*` → `GaussAA.*`
- 文档、测试里的扩展 ID：`GaussAA.office-viewer-plus`

扩展名 `office-viewer-plus` 与设置命名空间 `vscode-office` **不变** —— 改的是发布者身份，
不是产品名，也不是用户已有的配置键。

## 为什么现在改而不是以后

两个 registry 都还没有这个扩展的任何一个版本（Marketplace 与 Open VSX 的公开查询均为空，
见 #6）。发布者身份一旦有版本发布过就**不可改**：Marketplace 的 publisher ID 创建后不能重命名，
换了等于一个新扩展，已有安装不会跟随。所以这是唯一没有代价的时刻。

## 后果

- **创建 publisher 时必须逐字输入 `GaussAA`**（大小写敏感于你的输入，不敏感于解析）。
  建成 `gaussaa` 之后再发布 `GaussAA.office-viewer-plus` 会失败。
- 命令 ID 变了。这在本仓库当前没有用户，所以没有兼容包袱；若将来再改，需要保留旧 ID 的别名
  命令一段时间。
- ADR-0002 里那句「自有身份 `chaowu21.office-viewer-plus`」**保持原样**：ADR 记录的是当时的
  判断与处境，事后改写会让读者以为从一开始就是 `GaussAA`。身份变更由本 ADR 承接。
- `docs/release/trusted-publishing.md` 里的受信发布策略与 Open VSX 命名空间，都要按
  `GaussAA` 配置。
