# 版本 6.11.1 发布完成

**发布时间**: 2026-11-14 13:30 (UTC+8)  
**状态**: ✅ 成功发布

---

## 📦 发布内容

### 修复的 Bug (3个)

#### 1. 空值计算优化 ✓

**问题**: 空数组 `[]` 未被计入空值统计  
**影响**: LIST 列的空值百分比不准确  
**修复**:

- 在 `scanParquetColumn()` 中添加空数组检测
- 在 `profileFromParquet()` 中过滤空字节数组

**文件**: `src/service/parquetProfile.ts`  
**测试**: `test/unit/parquet-profile.test.ts`

#### 2. 类型显示统一 ✓

**问题**: UTF8 和 STRING 类型显示不一致  
**修复**: UTF8 统一显示为 STRING（UTF8 是默认编码）

**文件**: `src/react/view/parquet/parquetParser.ts`

#### 3. URL 字段识别 ✓

**问题**: URL 列显示为普通 STRING，不易识别  
**修复**: 通过列名模式检测 URL 列，在 schema 侧边栏显示为 `link`

**检测模式**: `url`, `link`, `href`, `uri`, `*_url`, `*_link` 等  
**文件**: `src/react/view/parquet/parquetParser.ts`, `ParquetSchema.tsx`  
**测试**: `test/unit/parquet-url-detection.test.ts`

### ❌ 未包含的改进

**字段跳转动画优化** - 延后到未来版本

- 原因: 平滑滚动在 CI 环境中不稳定，多次测试失败
- 决策: 保留原有的工作实现，避免阻塞发布
- 未来: 可以作为单独的 PR 重新评估

---

## ✅ 质量验证

### 本地测试

```
✓ 379 个单元测试全部通过
✓ 83 个 UI 验收场景通过
✓ 12 个性能检查通过
✓ 类型检查: 0 错误
✓ Lint: 0 警告/错误
✓ 格式检查: 通过
✓ 发布预检: 通过
```

### CI/CD

```
✓ Check, build, verify UI (1m 30s)
✓ Release preflight
✓ Package vsix
✓ Upload vsix
✓ Publish to VS Code Marketplace (OIDC)
✓ Publish to Open VSX (trusted publishing)
✓ Create GitHub Release
```

**总耗时**: 2分33秒  
**GitHub Actions**: https://github.com/GaussAA/vscode-office/actions/runs/43561895140

---

## 📋 发布渠道

### 1. GitHub Release ✅

**状态**: 已发布  
**URL**: https://github.com/GaussAA/vscode-office/releases/tag/v6.11.1  
**发布时间**: 2026-11-14T05:33:30Z  
**附件**: office-viewer-plus-6.11.1.vsix

### 2. Open VSX 🔄

**状态**: 等待传播中（5-10 分钟）  
**上次版本**: 6.11.0  
**检查命令**:

```bash
curl -s https://open-vsx.org/api/GaussAA/office-viewer-plus | jq -r '.version'
```

### 3. VS Code Marketplace 🔄

**状态**: 等待传播中（5-10 分钟）  
**检查命令**:

```bash
curl -s -X POST https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery \
  -H 'Content-Type: application/json' \
  -d '{"filters":[{"criteria":[{"filterType":7,"value":"GaussAA.office-viewer-plus"}]}],"flags":914}' \
  | jq -r '.results[0].extensions[0].versions[0].version'
```

---

## 📝 变更统计

```
6 files changed, 257 insertions(+), 24 deletions(-)

修改的文件:
 M CHANGELOG.md                                     (+11, -8)
 M package.json                                     (+1, -1)
 M src/react/view/parquet/ParquetSchema.tsx         (+2, -2)
 M src/react/view/parquet/parquetParser.ts          (+50, -22)
 M src/service/parquetProfile.ts                    (+29, -6)
 M test/unit/parquet-profile.test.ts                (+7)

新增文件:
 A docs/fixes/parquet-ux-improvements-2026-11-14.md (135 lines)
 A test/unit/parquet-url-detection.test.ts          (72 lines)
```

---

## 🔄 发布流程回顾

### 遇到的问题

1. **Tag 指向错误的提交** (已解决)
   - 原因: 手动操作失误
   - 解决: 删除并重新创建 tag

2. **滚动动画在 CI 失败** (已规避)
   - 问题: `parquet-json-links-column-jump` 测试超时
   - 尝试: 平滑滚动 → instant scroll → scrollLeft 直接赋值
   - 决策: 回退到原有实现，保证稳定性
   - 影响: 无，其他 3 个 bug 修复不受影响

### 成功因素

- ✅ 充分的本地测试（单元测试 + UI 验收 + 性能）
- ✅ CI 预检通过才推送
- ✅ OIDC 可信发布（无需 PAT）
- ✅ 自动化的 GitHub Release 创建

---

## 📖 相关文档

- **修复详情**: [docs/fixes/parquet-ux-improvements-2026-11-14.md](fixes/parquet-ux-improvements-2026-11-14.md)
- **发布规范**: [docs/agents/release.md](agents/release.md)
- **CHANGELOG**: [CHANGELOG.md](../CHANGELOG.md)

---

## 🎯 后续步骤

1. ⏳ **等待注册表传播** (5-10 分钟)
   - Open VSX: 6.11.0 → 6.11.1
   - Marketplace: 检查更新

2. ✅ **验证用户可见性**
   - 在 VS Code 中搜索扩展更新
   - 确认 Open VSX 页面显示新版本

3. 📢 **通知用户**（可选）
   - 如果有社区或通知渠道

---

**最后更新**: 2026-11-14 13:35 (UTC+8)  
**发布状态**: ✅ 成功  
**下一个版本**: 6.11.2 或 6.12.0
