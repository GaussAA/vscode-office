# Parquet 数据预览 UX 改进

**日期**: 2026-11-14  
**类型**: Bug 修复 + UX 优化

## 概述

针对 Parquet 数据预览器的四个用户体验问题进行了修复和优化。

## 修复详情

### 1. 空值计算：空列表也算作空值

**问题**: 空值统计只覆盖 `null`/`undefined`，但对于列表数据结构，空列表（`[]`）也应该算作空值。

**修复**:

- **文件**: `src/service/parquetProfile.ts`
- **改动**:
  - 在 `scanParquetColumn()` 中，扫描列值时将空数组视为 null
  - 在 `profileFromParquet()` 中，检查 min/max 统计值是否为空字节数组（LIST 列的空数组表示）
  - 添加 `isEmptyValue()` 辅助函数判断空值

**影响**: 列画像中的空值百分比现在更准确地反映了列表列的数据质量。

### 2. 字段跳转动画：平滑滚动替代生硬跳转

**问题**: 点击左侧 schema 字段时，右侧表格跳转到对应列的过程生硬，没有动画效果，且有抖动。

**修复**:

- **文件**: `src/react/view/parquet/useParquetColumnFocus.ts`
- **改动**:
  - 移除了复杂的模拟拖动滚动条逻辑（~180 行代码）
  - 使用原生 `scrollTo({ behavior: 'smooth' })` 实现平滑滚动
  - 保留重试机制处理虚拟列表重建滚动条的情况
  - 减少超时时间从 1200ms 到 800ms（更快响应）
  - 遵守 `prefers-reduced-motion` 无障碍偏好

**影响**:

- 字段跳转现在有流畅的滚动动画
- 代码更简单、更易维护（从 210 行减少到 ~120 行）
- 更好的无障碍支持

### 3. 类型显示统一：UTF8 → STRING

**问题**: 字符串字段类型显示不一致，有时是 `string`，有时是 `UTF8`。

**修复**:

- **文件**: `src/react/view/parquet/parquetParser.ts`
- **改动**:
  - 在 `formatSchemaType()` 和 `formatColumnType()` 中标准化 UTF8 类型
  - UTF8 是 STRING 的默认编码，因此统一显示为 `STRING`

**影响**: 所有字符串类型列现在一致地显示为 `STRING`，用户界面更统一。

### 4. URL 字段类型识别：link 类型标识

**问题**: 可点击的 URL 链接字段类型显示为 `string`，没有明确标识其链接性质。

**修复**:

- **文件**:
  - `src/react/view/parquet/parquetParser.ts`
  - `src/react/view/parquet/ParquetSchema.tsx`
- **改动**:
  - 在 `ParquetColumnInfo` 接口中添加可选的 `displayType` 字段
  - 在 `describeColumn()` 中通过列名模式检测 URL 列（包含 `url`、`link`、`href`、`uri` 等）
  - 在 schema 侧边栏中显示 `link` 而不是 `STRING`
  - 仅对非嵌套的字符串列进行检测

**检测规则**:

- 列名（不区分大小写）包含：`url`, `link`, `href`
- 列名等于：`uri`
- 列名模式：`*_url`, `*_link`, `url_*`, `link_*`

**影响**: URL 列现在在 schema 侧边栏中显示为 `link` 类型，用户可以立即识别哪些字段包含可点击的链接。

## 测试

### 新增测试

- **文件**: `test/unit/parquet-url-detection.test.ts`
- **覆盖**:
  - URL 列名检测的各种模式
  - 嵌套列不被误识别为 URL
  - UTF8 类型标准化
  - 非字符串列不被标记为 URL

### 更新测试

- **文件**: `test/unit/parquet-profile.test.ts`
- **添加**: 空数组作为 null 的测试占位符（待添加具有 LIST 列的 fixture）

### 测试结果

```
✓ 所有 379 个单元测试通过
✓ 类型检查：0 错误
✓ Lint 检查：0 警告/错误
✓ 格式检查：通过
```

## 向后兼容性

所有改动都是向后兼容的：

1. **空值计算**: 统计更准确，不会破坏现有逻辑
2. **滚动动画**: 行为改进，API 未变
3. **类型显示**: 仅影响显示文本，不影响数据处理
4. **URL 检测**: 添加可选字段，不影响现有列

## 性能影响

- **字段跳转**: 移除模拟拖动减少了 CPU 开销，使用原生 smooth scroll 性能更好
- **URL 检测**: 仅在列元数据解析时执行一次，零运行时开销
- **空值计算**: 仅在扫描时增加数组长度检查，开销可忽略

## 未来改进

1. **空值计算**: 添加包含 LIST 列的测试 fixture 以完整验证空数组处理
2. **URL 检测**: 可考虑采样前几行数据来检测实际 URL 内容（需权衡性能）
3. **动画**: 可添加配置选项控制滚动动画时长

## 相关文件

- `src/service/parquetProfile.ts` - 空值计算逻辑
- `src/react/view/parquet/useParquetColumnFocus.ts` - 字段跳转动画
- `src/react/view/parquet/parquetParser.ts` - 类型标准化和 URL 检测
- `src/react/view/parquet/ParquetSchema.tsx` - Schema 侧边栏显示
- `test/unit/parquet-url-detection.test.ts` - URL 检测测试
- `test/unit/parquet-profile.test.ts` - 列画像测试
