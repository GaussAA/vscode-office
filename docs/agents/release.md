# Release 规范

发布是对外承诺，格式漂移会让用户分不清版本与内容。下面是本仓库唯一的一套写法；无论是谁、
用什么工具发，都按这里来。

## 唯一命名格式

| 东西                | 格式                                                                | 例子                                              |
| ------------------- | ------------------------------------------------------------------- | ------------------------------------------------- |
| Git tag             | `v<major>.<minor>.<patch>`                                          | `v6.4.1`                                          |
| GitHub Release 标题 | `Data File Viewer (Parquet, JSONL, Excel) v<major>.<minor>.<patch>` | `Data File Viewer (Parquet, JSONL, Excel) v6.4.1` |
| Release 正文小标题  | `### Added` / `### Changed` / `### Fixed` / `### Removed`           | —                                                 |
| 附件名              | `<name>-<version>.vsix`（vsce 自动生成）                            | `office-viewer-plus-6.4.1.vsix`                   |
| CHANGELOG 小节      | `## [<version>] - <YYYY-MM-DD>`                                     | `## [6.4.1] - 2026-11-10`                         |

三条硬规则：

1. **标题只写产品名与版本**：`Data File Viewer (Parquet, JSONL, Excel) v6.4.1`。不写「项目质量全面提升」这类后缀 ——
   那是发布说明的正文，不是标题；也不写裸版本号（`6.4.0`）或带 `v` 却省产品名（`v6.2.0 - …`）。
   历史上有过这三种写法，已统一。
2. **正文不要重复版本号**：GitHub 已经把版本与日期放在标题和左侧，正文第一行也不要再写
   `## [6.4.1] - 2026-11-10`（CHANGELOG 里需要，Release 里重复）。正文直接进 `### Added`。
3. **正文与 CHANGELOG 同源**：Release 正文 = CHANGELOG 里该版本小节的内容，去掉那一行标题。
   不同步就是两份事实。

## 谁在发

两个注册表都由 `.github/workflows/release.yml` 发布，**打 tag 即触发**。两边都用 OIDC 换短期凭据
（`vsce publish --oidc` / `ovsx publish --trusted-publishing`），仓库里没有任何发布用 secret。
总开关是仓库变量 `PUBLISH_ENABLED`（当前 `true`）；删掉它，tag 就只跑闸门、打包、上传 artifact。

## 发一次版的清单

- [ ] **1. 版本号**：`package.json` 的 `version` 与将要打的 tag 一致
- [ ] **2. CHANGELOG**：把 `[Unreleased]` 并进 `## [<version>] - YYYY-MM-DD`，并留一个空的 `[Unreleased]`
- [ ] **3. 本地预检**：`pnpm run check:release`
      （版本格式、CHANGELOG 小节、图标 ≥128px PNG、l10n、工作流自检；CI 会带 `--tag` 再比一次 tag 与版本）
- [ ] **4. 提交**：`git add -A && git commit -m "release: <version>"`
- [ ] **5. 打 tag 并推送**：
      `git tag -a v<version> -m "Data File Viewer (Parquet, JSONL, Excel) <version>"`
      `git push origin main && git push origin v<version>`
- [ ] **6. 等 CI**：`gh run watch` —— 顺序是 `check:full` → `check:release --tag=` → 打包 →
      **Marketplace（OIDC）** → **Open VSX（trusted publishing）**
- [ ] **7. 验证两个注册表**（见下，注意传播延迟）
- [ ] **8. 建 GitHub Release**：正文取 CHANGELOG 该小节（去掉 `## [...]` 那一行），附件用 CI 打的那个
      `bash
      gh run download <run-id> -n release-vsix          # 取 CI 产物，别用本地旧 vsix
      gh release create v<version> --title "Data File Viewer (Parquet, JSONL, Excel) v<version>" \
        --notes-file /tmp/notes.md "office-viewer-plus-<version>.vsix"
      `

`pnpm check:full` 与 `pnpm run package` **不必在本地再跑**：CI 在 tag 上跑完整闸门并打包。

## 校验两个注册表（两个都要，且要等）

传播延迟实测：**Open VSX 约 1 分钟**（其间直接 404）、**Marketplace 约 6 分钟**。发布步骤返回
success 之后立刻查询会误判成失败。

```bash
# Open VSX：期望 "version":"<version>"
curl -s "https://open-vsx.org/api/GaussAA/office-viewer-plus?cb=$RANDOM" | head -c 200

# Marketplace：结果里应出现 <version>（flags=914 才带版本列表）
curl -s -X POST 'https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery' \
  -H 'Accept: application/json;api-version=7.2-preview.1' -H 'Content-Type: application/json' \
  --data '{"filters":[{"criteria":[{"filterType":7,"value":"GaussAA.office-viewer-plus"}],"pageNumber":1,"pageSize":1}],"assetTypes":[],"flags":914}'
```

## 发布失败怎么办

| 情况                                            | 处理                                                                                                                                                       |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Marketplace 失败**（最常见：图标/元数据被拒） | 什么都没发出去 —— 修好后**重试同一个版本号**                                                                                                               |
| Marketplace 成功、Open VSX 失败                 | 版本号已烧，只能升版本重发（6.4.5 → 6.4.6 就是这么来的）                                                                                                   |
| 只想补发其中一边                                | `gh workflow run release.yml -f publish_marketplace=false -f publish_openvsx=true`（或反过来）。**不要重跑整个 job**：已成功的那个注册表会因版本号占用而红 |
| 发出去又想撤回                                  | 不可能再发同一个号 —— 注册表永久保留已发布的版本身份                                                                                                       |

工作流把 Marketplace 排在 Open VSX 之前不是随意：Marketplace 验证更严，它在前面失败就什么都没发出去，
代价最小。细节与三条实测坑见 `docs/release/trusted-publishing.md` 的 G 节。

## 校验历史标题同形

```bash
gh release list --repo GaussAA/vscode-office --limit 30
```

任何一条不符合上表，都算发布缺陷，就地修（`gh release edit <tag> --title …`），不要等下周。

## 为什么写下来

6.4.0 之前，同一个仓库出现过「`6.4.0`」「`Office Viewer Plus 6.3.0`」「`v6.2.0 - 项目质量全面提升`」
三种标题；正文有的重复版本号、有的不重复；还有一个 `v4.4.0` 打了 tag 却没有 Release。这些都
不是「风格」，是让人无法判断版本关系的噪音。
