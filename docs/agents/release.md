# Release 规范

发布是对外承诺，格式漂移会让用户分不清版本与内容。下面是本仓库唯一的一套写法；无论是谁、
用什么工具发，都按这里来。

## 唯一命名格式

| 东西                | 格式                                                      | 例子                            |
| ------------------- | --------------------------------------------------------- | ------------------------------- |
| Git tag             | `v<major>.<minor>.<patch>`                                | `v6.4.1`                        |
| GitHub Release 标题 | `Office Viewer Plus v<major>.<minor>.<patch>`             | `Office Viewer Plus v6.4.1`     |
| Release 正文小标题  | `### Added` / `### Changed` / `### Fixed` / `### Removed` | —                               |
| 附件名              | `<name>-<version>.vsix`（vsce 自动生成）                  | `office-viewer-plus-6.4.1.vsix` |
| CHANGELOG 小节      | `## [<version>] - <YYYY-MM-DD>`                           | `## [6.4.1] - 2026-11-10`       |

三条硬规则：

1. **标题只写产品名与版本**：`Office Viewer Plus v6.4.1`。不写「项目质量全面提升」这类后缀 ——
   那是发布说明的正文，不是标题；也不写裸版本号（`6.4.0`）或带 `v` 却省产品名（`v6.2.0 - …`）。
   历史上有过这三种写法，已统一。
2. **正文不要重复版本号**：GitHub 已经把版本与日期放在标题和左侧，正文第一行也不要再写
   `## [6.4.1] - 2026-11-10`（CHANGELOG 里需要，Release 里重复）。正文直接进 `### Added`。
3. **正文与 CHANGELOG 同源**：Release 正文 = CHANGELOG 里该版本小节的内容，去掉那一行标题。
   不同步就是两份事实。

## 发一次版的步骤

```bash
# 1. 版本号与 CHANGELOG 收口：把 [Unreleased] 并进待发版本，留一个空的 [Unreleased]
#    package.json 的 version 必须与 tag 一致
# 2. 完整闸门（smoke 证明真实宿主能激活，perf 证明大文件没退化）
pnpm check:full
# 3. 打包
pnpm run package
# 4. 提交并打 tag
git add -A && git commit -m "release: <version>"
git tag -a v<version> -m "Office Viewer Plus <version>"
# 5. 推送代码与 tag
git push origin main && git push origin v<version>
# 6. 建 Release（标题按上表，正文取自 CHANGELOG 该小节）
gh release create v<version> --title "Office Viewer Plus v<version>" \
  --notes-file /tmp/notes.md "office-viewer-plus-<version>.vsix"
```

## 校验

```bash
gh release list --repo GaussAA/vscode-office --limit 30   # 标题应全部同形
```

任何一条不符合上表，都算发布缺陷，就地修（`gh release edit <tag> --title …`），不要等下周。

## 为什么写下来

6.4.0 之前，同一个仓库出现过「`6.4.0`」「`Office Viewer Plus 6.3.0`」「`v6.2.0 - 项目质量全面提升`」
三种标题；正文有的重复版本号、有的不重复；还有一个 `v4.4.0` 打了 tag 却没有 Release。这些都
不是「风格」，是让人无法判断版本关系的噪音。
