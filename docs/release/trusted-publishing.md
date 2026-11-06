# 发布链路：受信发布配置清单

面向**只能由人完成**的步骤。仓库侧能自动检查的部分（图标、版本号格式、`l10n` 目录、工作流里的
OIDC 标志、tag 与 `package.json` 是否一致）已经做成 `pnpm check:release`，CI 在打 tag 后、打包前
会跑一遍。这里只写浏览器里点出来的东西。

截止压力：**Azure DevOps 全局 PAT 于 2026-12-01 退役**。之后靠 PAT 发布的路子整体消失。

**如果来不及在截止前完成配置**，损失的是「CI 自动发布到 Marketplace」，不是「无法发布」——
见文末 [F. 来不及配置怎么办](#f-来不及配置怎么办)。这份清单目前处于**挂起**状态：需要在
一台已登录相关账号的机器上操作；过渡做法见 [manual-publish.md](./manual-publish.md)。

## 已经查过的现状（2026-11-06）

| 事实 | 怎么查的 | 结论 |
|---|---|---|
| Marketplace 上没有 `GaussAA.office-viewer-plus` | Gallery `extensionquery` API，`filterType: 7` | 未发布过 |
| 同一个查询能查到上游 `cweijan.vscode-office` v4.2.3 | 同上 | 说明查询本身有效，上一条的"查不到"是有意义的 |
| Open VSX 上没有 `GaussAA/office-viewer-plus` | `GET https://open-vsx.org/api/GaussAA/office-viewer-plus` | 404 |
| Open VSX 没有 `GaussAA` 命名空间 | `GET https://open-vsx.org/api/namespace/GaussAA` | 404 |
| 仓库里没有任何发布用 secret | `gh secret list` | 空（符合设计：两边都不存 secret） |
| 仓库是**公开**的 | `gh repo view` | 公开 —— Open VSX 的私有仓库注册码流程用不上 |

所以这不是"把已有的 PAT 发布改成 OIDC"，而是**两个仓库的首次发布**。这降低了风险：
没有已存在的版本会被占用，首次失败也不会留下半个版本。

## A. VS Code Marketplace（OIDC 受信发布）

### A1. 确认 publisher `GaussAA` 存在

打开 <https://marketplace.visualstudio.com/manage>，用发布扩展的 Microsoft 账号登录。

- 左侧能看到 `GaussAA` → 直接进入 A2。
- 看不到 → 点 **Create publisher**，**ID 必须是 `GaussAA`**（与 `package.json` 的
  `publisher` 一致，创建后不可改），Name 可以随便填一个展示名。

**验证**：刷新后左侧列表出现 `GaussAA`。

### A2. 创建受信发布策略

在 publisher 页面 → **Trusted Publishing** → 展开 **Create**，填：

| 字段 | 值 | 注意 |
|---|---|---|
| Policy name | `Release workflow` | 只是给人看的 |
| Repository owner | `GaussAA` | 精确的 GitHub 登录名 |
| Repository | `vscode-office` | 不带 owner |
| Workflow | `release.yml` | `.github/workflows` 下的文件名 |
| Environment | **留空** | 我们的 workflow 没有 `environment:`；填了就会对不上 |

点 **Create**。

**验证**：策略出现在列表里，五个字段与上表逐字一致。任何一处拼写错误都会让 token 交换被拒，
而错误信息只说"策略不匹配"。

> 私有仓库需要在创建策略后 **48 小时内**跑一次工作流完成激活；本仓库是公开的，没有这个限制。

### A3. 可选：确认没有残留 PAT

`gh secret list` 现在是空的，`release.yml` 也不引用 `VSCE_PAT`。这一项由 `check:release`
自动拦（会屏蔽注释后再匹配，避免命中文件里解释 PAT 退役的说明文字）。

## B. Open VSX（trusted publishing）

### B1. 建命名空间并拿到所有权

`ovsx` 用 `package.json` 的 `publisher` 作为命名空间，所以命名空间必须叫 `GaussAA`。

1. 用 Eclipse 账号登录 <https://open-vsx.org>。
2. 用访问令牌创建命名空间（令牌在 <https://open-vsx.org/user-settings/tokens>）：

   ```bash
   npx ovsx create-namespace GaussAA --pat <token>
   ```

3. **主张所有权**。只建命名空间不会给你独占发布权——按
   [Namespace Access](https://github.com/eclipse/openvsx/wiki/Namespace-Access) 的流程提出主张。

**验证**：`curl -s https://open-vsx.org/api/namespace/GaussAA` 不再返回 404。

### B2. 注册受信发布者

打开 <https://open-vsx.org/user-settings/trusted-publishers>，为命名空间 `GaussAA` 注册：

- **仓库**：`GaussAA/vscode-office`
- **工作流**：`release.yml`

**验证**：条目出现在 trusted publishers 列表。

> **公开仓库**（我们）不需要注册码。私有仓库会在注册时给一个 7 天有效的一次性
> `--registrationCode`，首次发布时通过 `OVSX_REGISTRATION_CODE` 传入；后续不再需要。

## B3. 打开自动发布的开关

配置完成前，工作流的两个发布步骤是**关着的**：tag 只会跑闸门、打包、上传 artifact，不会去
碰任何 registry。这样 tag 不会因为"还没配置"而变红 —— 红色只代表真的出问题。

两个 registry 都配置好之后，开这个开关，tag 才会自动发布：

```bash
gh variable set PUBLISH_ENABLED --repo GaussAA/vscode-office --body true
```

想临时关掉就把变量删掉（`gh variable delete PUBLISH_ENABLED --repo GaussAA/vscode-office`）。
`workflow_dispatch` 的两个输入不受这个开关约束 —— 补发某一次失败的那一半时仍然可以直接勾选。

## C. 首次真实发布

### C1. 本地预检

```bash
pnpm check:release -- --tag=v4.4.2
```

（`check:release` 不带 `--tag` 时跳过 tag 比对。）

### C2. 打 tag

先确认 `package.json` 的 `version` 与 tag 一致——`check:release` 会在 CI 里再比一次。

```bash
git tag v4.4.2
git push origin v4.4.2
```

### C3. 看两条发布步骤

`Release` 工作流会依次：跑 `check:full` → `check:release` → 打包 → 传 artifact →
Marketplace（`vsce publish --oidc`）→ Open VSX（`ovsx publish --trusted-publishing`）。

**验证**（两个都要）：

```bash
# 应该返回一个 hit，版本是 4.4.2
curl -s -X POST 'https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery' \
  -H 'Accept: application/json;api-version=7.2-preview.1' -H 'Content-Type: application/json' \
  --data '{"filters":[{"criteria":[{"filterType":7,"value":"GaussAA.office-viewer-plus"}],"pageNumber":1,"pageSize":1}],"assetTypes":[],"flags":914}'

# 应该返回 200 和版本号
curl -s https://open-vsx.org/api/GaussAA/office-viewer-plus | head -c 200
```

## D. 一半成功怎么办

版本号不能被复用，所以"Marketplace 成功、Open VSX 失败"之后重跑整个 job 会卡在 Marketplace
的 *already exists*。为此 `workflow_dispatch` 提供了两个开关：

**Actions → Release → Run workflow**，把 `publish_marketplace` 取消勾选、`publish_openvsx` 保持勾选，
用**同一个 tag** 重跑。

反过来（Open VSX 成功、Marketplace 失败）同理，勾选相反的那个。

> 前提是 workflow 跑在 tag 上。`workflow_dispatch` 从 `main` 触发时，`github.ref` 不是 tag，
> 两个 `if` 都退化成"看输入"。所以恢复时必须**在 tag 上**重新 dispatch：
> `gh workflow run release.yml --ref v4.4.2`。

## E. 哪些是自动的，哪些只能人做

| 项目 | 谁负责 |
|---|---|
| 图标是 PNG 且 ≥128px | `check:release` |
| `version` 是 `major.minor.patch`（Marketplace 不接受 semver 预发布后缀） | `check:release` |
| tag 与 `version` 一致 | `check:release` |
| `README` / `LICENSE` / `CHANGELOG` 存在、`license` 字段存在 | `check:release` |
| `l10n` 目录与 `package.json.l10n` | `check:release` |
| 工作流有 `id-token: write`、`--oidc`、`--trusted-publishing`，且不引用 PAT | `check:release` |
| **Marketplace 受信策略存在且字段匹配** | 人（A2） |
| **Open VSX 命名空间存在、已主张所有权** | 人（B1） |
| **Open VSX 受信发布者已注册** | 人（B2） |

最后三项无法在仓库里验证——需要登录态。它们的失败信息分别是
"trusted publishing policy not found"（Marketplace）和 "no matching trusted publisher"（Open VSX），
两种都只会在打 tag 之后才出现，所以 A2/B1/B2 务必在 C2 之前完成。

## F. 来不及配置怎么办

截止日期只影响**一条**路径，值得说清楚，免得把 2026-12-01 理解成"之后就不能发布了"。

| 路径 | 2026-12-01 之后 |
|---|---|
| `vsce publish` + PAT（本地或 CI） | **失效** —— Marketplace 的认证就是 Azure DevOps，全局 PAT 退役 |
| `vsce publish --oidc`（本仓库的 CI） | 可用，前提是 A2 配好 |
| **手动上传 vsix** | **仍然可用** —— 浏览器会话，不涉及 PAT |

手动上传的操作：本地 `pnpm run package`，打开
<https://marketplace.visualstudio.com/manage>，在扩展页面选择上传 vsix。代价是每次发布都要人做，
且拿不到 CI 的 `check:full` 作为发布前的闸门（本地得自己跑一遍）。

**Open VSX 完全不受这个日期影响**：它用 Eclipse 账号和 Open VSX 自己的访问令牌，与 Azure DevOps
无关。所以 B1/B2 可以慢慢来，只有 Marketplace 的 A2 有真实的时间压力。

结论：即使挂起到截止日之后，也只是"每次发布手动上传"，不会失去发布能力。

## 参考

- [Publishing Extensions — Secure automated publishing](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#secure-automated-publishing-to-visual-studio-marketplace)
- [`vscode-vsce` — Trusted publishing](https://github.com/microsoft/vscode-vsce#trusted-publishing)
- [`ovsx` CLI — Trusted Publishing](https://github.com/eclipse-openvsx/openvsx/blob/master/cli/README.md)
- [Azure DevOps 全局 PAT 退役公告](https://devblogs.microsoft.com/devops/retirement-of-global-personal-access-tokens-in-azure-devops/)
