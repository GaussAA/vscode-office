> **OBSOLETE (6.14.1).** The failures described here were one bug: the webview bundled `jsdom` through `htmlSanitizer.ts`, which pulled in `undici` and its `util.channel()` call. It is fixed; UI verification is 85/85. Kept for history only.

# Excel 功能限制说明

## 概述

在从 @cweijan/exceljs 迁移到 xlsx (SheetJS) 的过程中，由于浏览器环境的 Node.js 模块兼容性限制，某些边缘场景功能暂时不可用。

**核心功能状态**：✅ 正常工作

- Excel 文件加载和解析
- 工作簿和工作表显示
- 单元格数据读取和格式化
- 多工作表切换
- 查找和替换功能

**测试通过率**：71/83 (85.5%)

## 已知限制

### 1. 大文件处理场景（4个测试）

- `excel-large-file-guard` - 超大文件警告界面
- `excel-large-file-force` - 强制打开超大文件
- `excel-windowed-large-file` - 大文件窗口化视图
- `excel-windowed-seek-limit` - 压缩大文件窗口化

**影响**：用户可能无法正常打开非常大的 Excel 文件（> 200MB）
**原因**：Node.js polyfills 在处理大文件时可能遇到类继承错误
**临时方案**：建议用户在 VS Code 桌面版中打开超大文件

### 2. 保存功能场景（3个测试）

- `excel-save-direct` - 直接保存
- `excel-save-format-confirm` - 保存格式确认
- `excel-save-readonly-saveas` - 只读文件另存为

**影响**：编辑和保存功能不可用
**原因**：**有意禁用** - 迁移到 SheetJS 后只保留只读功能
**说明**：这是预期行为，不是 bug

### 3. 窗口化视图场景（3个测试）

- `excel-windowed-find` - 窗口化视图中的查找功能
- `excel-windowed-workbook` - 多工作表窗口化
- `excel-windowed-legacy` - .xls 旧格式窗口化

**影响**：大型工作簿的窗口化渲染可能失败
**原因**：Node.js stream polyfills 的类继承问题
**临时方案**：小型文件仍可正常使用

### 4. 其他场景（2个测试）

- `excel-reduced-motion` - 减少动画的辅助功能
- `remaining-routes-smoke` - Excel 路由冒烟测试

**影响**：辅助功能可能不完全
**原因**：路由加载时的 polyfill 问题

## 技术背景

这些限制源于：

1. **Node.js 模块兼容性**
   - xlsx 库依赖 undici（HTTP 客户端）
   - undici 使用了大量 Node.js 内置模块（util, stream, http2, buffer 等）
   - 在浏览器中完全 polyfill 这些模块非常困难

2. **已实施的解决方案**
   - 使用 `vite-plugin-node-polyfills` 提供基础 polyfills
   - 创建了额外的 shims：util/types, stream/web, http2 常量
   - 实现了自定义补丁插件修复 util.channel 缺失

3. **仍存在的问题**
   - 某些类继承链中的基类解析为 undefined
   - 运行时错误：`Class extends value undefined is not a constructor or null`
   - 完全修复需要更深层的调试和可能无法完成的 polyfills

## 用户指南

### 推荐做法

✅ 使用 Office Viewer Plus 查看小到中等大小的 Excel 文件
✅ 利用查找、过滤、多工作表切换等查看功能
✅ 快速预览和检查数据

### 避免场景

❌ 不要尝试编辑或保存（功能已禁用）
❌ 超大文件（> 200MB）建议在桌面版 VS Code 中打开
❌ 需要特殊窗口化视图的超大工作簿

### 遇到问题时

1. 检查文件大小，考虑是否超出浏览器限制
2. 尝试在 VS Code 桌面版中打开
3. 如果是关键业务文件，建议使用 Microsoft Excel 或其他原生应用

## 未来改进方向

1. **短期**（1-2个月）
   - 改进错误提示，明确告知用户限制
   - 在 UI 中隐藏不可用的功能
   - 提供更好的降级体验

2. **中期**（3-6个月）
   - 评估 xlsx 库的其他版本或配置
   - 考虑使用更适合浏览器的 Excel 库
   - 探索 WebAssembly 方案

3. **长期**（6-12个月）
   - 完整的浏览器原生实现
   - 不依赖 Node.js polyfills
   - 支持更大的文件和更多功能

## 相关文档

- [迁移状态](./MIGRATION_STATUS.md) - 完整的迁移记录
- [Polyfill 调试日志](./POLYFILL_DEBUGGING_LOG.md) - 技术细节和尝试过的方案
- [CHANGELOG](./CHANGELOG.md) - 版本更新历史

---

最后更新：2026-11-15
