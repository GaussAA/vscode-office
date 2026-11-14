# 版本 6.11.1 发布进行中

**发布时间**: 2026-11-14  
**类型**: Bug 修复版本

## 发布状态

✅ **代码提交**: 已完成  
✅ **版本标签**: v6.11.1 已推送  
✅ **主分支**: 已推送到 origin/main  
🔄 **CI/CD**: Release 工作流运行中 (手动触发)

GitHub Actions: https://github.com/GaussAA/vscode-office/actions/runs/43466903770

## 修复内容

### 1. 空值计算优化

- 空列表（`[]`）现在被正确计入空值统计
- 列画像的空值百分比更准确地反映数据质量

### 2. 字段跳转动画

- 使用原生平滑滚动替代模拟拖动
- 流畅的滚动动画
- 代码简化（从 210 行减少到 120 行）

### 3. 类型显示统一

- UTF8 统一显示为 STRING
- 界面更一致

### 4. URL 字段识别

- URL 列在 schema 侧边栏显示为 `link` 类型
- 更容易识别可点击的链接字段

## 测试覆盖

- ✅ 379 个单元测试全部通过
- ✅ 类型检查：0 错误
- ✅ Lint 检查：0 警告/错误
- ✅ 格式检查：通过
- ✅ 发布预检：通过

## 修改文件

```
9 files changed, 313 insertions(+), 104 deletions(-)

- CHANGELOG.md
- package.json
- src/service/parquetProfile.ts
- src/react/view/parquet/useParquetColumnFocus.ts
- src/react/view/parquet/parquetParser.ts
- src/react/view/parquet/ParquetSchema.tsx
- test/unit/parquet-profile.test.ts
- test/unit/parquet-url-detection.test.ts (新增)
- docs/fixes/parquet-ux-improvements-2026-11-14.md (新增)
```

## 发布流程

根据 docs/agents/release.md 的规范：

1. ✅ 更新 package.json 版本号
2. ✅ 更新 CHANGELOG.md
3. ✅ 运行 `pnpm run check:release`
4. ✅ 提交代码并打 tag
5. ✅ 推送到 GitHub
6. 🔄 GitHub Actions 自动发布到两个注册表
7. ⏳ 等待注册表传播（5-10 分钟）

## 等待事项

- [ ] VS Code Marketplace 发布完成
- [ ] Open VSX 发布完成
- [ ] GitHub Release 自动创建
- [ ] 验证两个注册表可见性（传播延迟 5-10 分钟）

## 注意事项

- 首次自动触发失败（可能是 tag 推送时序问题）
- 已手动重新触发工作流
- Release 工作流正在运行 check:full（需要约 2-3 分钟）

## 后续验证

发布完成后，等待 5-10 分钟验证：

```bash
# Open VSX
curl -s https://open-vsx.org/api/GaussAA/office-viewer-plus | jq -r '.version'

# Marketplace
curl -s -X POST https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery \
  -H 'Content-Type: application/json' \
  -d '{"filters":[{"criteria":[{"filterType":7,"value":"GaussAA.office-viewer-plus"}]}],"flags":914}' \
  | jq -r '.results[0].extensions[0].versions[0].version'
```

期望返回：`6.11.1`
