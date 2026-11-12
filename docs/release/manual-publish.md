# 手动发布（受信发布出问题时的兜底）

> **状态（2026-11）**：A2 / B1 / B2 已完成，`PUBLISH_ENABLED=true`，6.8.0 起发布走 CI
> （见 [release.md](../agents/release.md)）。本文只在受信发布本身坏掉时使用。

适用场景：`docs/release/trusted-publishing.md` 的受信发布链路暂时不可用，但现在必须发一个版本。

手动发布**不需要 PAT**（Marketplace 走浏览器会话），代价是每次都要人来做，而且发布前没有 CI
替你跑闸门 —— 所以本地这两条别省：

```bash
pnpm check          # lint + baseline + typecheck + 单测
pnpm check:full     # 上面全部 + build + smoke + verify:ui
```

## 一、打包

```bash
pnpm run check:release     # 图标、版本号、tag、l10n、README/LICENSE 等前置条件
pnpm run package           # 产出 office-viewer-plus-<version>.vsix
```

`check:release` 会拦住"打出来才发现"的问题（比如图标不是 PNG、版本号带了 semver 预发布后缀）。
产物在仓库根目录，`.gitignore` 已忽略 `.vsix`。

## 一·五、GitHub Release（不需要任何账号配置）

这是本仓库**已经在用**的发布方式：`v4.3.0` 就是把 vsix 挂在 GitHub Release 的附件里，
用户用 `code --install-extension <vsix>` 安装。它不经过 Marketplace，因此不需要 publisher
或任何 registry 的登录态，只需要仓库的 GitHub 权限。

```bash
gh release create v4.4.1 office-viewer-plus-4.4.1.vsix \
  --repo GaussAA/vscode-office \
  --title "Data File Viewer (Parquet, JSONL, Excel) 4.4.1" \
  --notes-file <notes.md>
```

tag 会触发 `Release` 工作流。若 `PUBLISH_ENABLED` 被关掉（见 trusted-publishing.md 的 B3），
它只跑闸门、打包、上传 artifact，不会去碰 registry，所以不会红；打开时它就是正常发布路径，
此时不要再用本文的手动步骤，否则会发布两次。

## 二、发到 VS Code Marketplace（浏览器）

1. 打开 <https://marketplace.visualstudio.com/manage>，用**属于 publisher `GaussAA` 的账号**登录。
2. 左侧没有 `GaussAA` → 先 **Create publisher**，ID 逐字输入 `GaussAA`（创建后不可改名）。
3. 右上 **New extension** → **Visual Studio Code** → 选择上一步的 `.vsix` → 上传。
   首次上传会要求补 Display name / 分类等元数据；`package.json` 里的信息会自动带过来。
4. **验证**（不需要登录）：

   ```bash
   curl -s -X POST 'https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery' \
     -H 'Accept: application/json;api-version=7.2-preview.1' -H 'Content-Type: application/json' \
     --data '{"filters":[{"criteria":[{"filterType":7,"value":"GaussAA.office-viewer-plus"}],"pageNumber":1,"pageSize":1}],"assetTypes":[],"flags":914}' \
     | grep -o '"TotalCount":[0-9]*'
   # TotalCount 应大于 0；或直接打开
   # https://marketplace.visualstudio.com/items?itemName=GaussAA.office-viewer-plus
   ```

## 三、发到 Open VSX（命令行，没有网页上传入口）

Open VSX 用**自己的**访问令牌，与 Azure DevOps 无关，**不受 2026-12-01 影响**，所以这条路
可以一直这么用。

1. 用 Eclipse 账号登录 <https://open-vsx.org>，在
   <https://open-vsx.org/user-settings/tokens> 生成访问令牌。
2. 首次需要建命名空间并**主张所有权**：

   ```bash
   npx ovsx create-namespace GaussAA --pat <token>
   ```

   只建命名空间不给独占发布权，按
   [Namespace Access](https://github.com/eclipse/openvsx/wiki/Namespace-Access) 走完主张流程。

3. 发布：

   ```bash
   npx ovsx publish office-viewer-plus-4.4.1.vsix --pat <token>
   ```

4. **验证**：`curl -s https://open-vsx.org/api/GaussAA/office-viewer-plus | head -c 200`

## 四、手动发布之后

- **版本号已被占用**。同一个版本不能再发一次，无论是手动还是 CI。修 bug 就升 patch 版本
  （`4.4.1` → `4.4.2`）再打包。
- 如果之后打 `v4.4.1` 的 tag，CI 的 `vsce publish` 会因为版本已存在而失败 —— 这不是配置
  错误，预期行为。tag 应该打在**还没发布过**的版本上。
- 手动发布不会创建 git tag。想让 tag 与已发布版本对应，就补一个
  `git tag v4.4.1 && git push origin v4.4.1`，但**不要再触发 release 工作流**去发布同一版本
  （`workflow_dispatch` 把两个开关都取消勾选，只留打包与上传 artifact）。

## 五、什么时候回到自动发布

完成 `trusted-publishing.md` 的 A2（Marketplace 受信策略）、B1/B2（Open VSX 命名空间与受信
发布者）之后，打一个**未发布过**的版本 tag 即可验证整条链路。配置好之后手动这条路随时可以停用。
