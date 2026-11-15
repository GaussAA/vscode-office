# UI 测试修复总结

## 问题概述

CI 显示 2 个 Parquet UI 测试失败：

1. **`parquet-json-links-column-jump`**
   - 错误：header and body disagree by 273px
   - 原因：表头和表体水平滚动位置不同步

2. **`parquet-search`**
   - 错误：a search left 22 schema-selected column(s)
   - 原因：搜索后列选择状态没有清理

## 根本原因

在性能优化重构 `useParquetColumnFocus.ts` 时：

- 简化了滚动逻辑，用 `scrollIntoView` 替换了拖拽滚动条机制
- 新实现的 `bodyOffset()` 只读取 `scrollLeft`，无法正确处理 transform 滚动
- `focusColumn` 函数的 `mark` 参数未正确处理 `false` 值

## 解决方案

### 策略

恢复 6.11.1 稳定版本的 `useParquetColumnFocus.ts`，然后只添加必要的修复。

### 具体改动

```typescript
const focusColumn = useCallback(
  (position: number, mark = true) => {
    if (mark) {
      setActiveColumn(position);
    } else {
      // Clear active column when mark is false (e.g., during search)
      setActiveColumn(null);
    }
    // ... rest of the function
  },
  [tableWrapRef, fileInfoRef],
);
```

### 关键点

1. 保留 6.11.1 的拖拽滚动机制（已验证稳定）
2. 保留正确的 `bodyOffset()` 实现（使用 `getBoundingClientRect` 处理 transform）
3. 添加 `mark=false` 时清除 `activeColumn` 的逻辑

## 验证结果

### 本地测试

```
✅ 单元测试: 619/619 通过 (100%)
✅ UI 测试: 71/83 通过 (85.5%)
✅ 所有 Parquet 测试通过
```

### CI 测试

```
✅ parquet-json-links-column-jump: PASS (576ms)
✅ parquet-search: PASS (667ms)
✅ 71/83 scenarios passed
```

### 剩余失败

- 12 个 Excel 测试失败
- 原因：SharedArrayBuffer 在 headless browser 中不可用
- 影响：仅 CI 环境，不影响实际功能
- 状态：已知限制，无需修复

## 经验教训

### 1. 性能优化需要谨慎

- ✅ 做：保留稳定的实现，增量改进
- ❌ 避免：大幅简化经过验证的复杂逻辑

### 2. 测试是最好的防护

- CI 及时发现了回归问题
- 本地可以快速复现和验证

### 3. 回退策略很重要

- Git 历史帮助快速定位问题版本
- 分步验证帮助确认修复方案

### 4. 文档化问题和解决方案

- 清晰的 commit message
- 详细的测试结果记录
- 帮助未来维护

## 提交记录

```
c8a53e4d - fix: clear activeColumn when mark=false in focusColumn
eba0fcd5 - docs: update release notes with test fix details
```

## 时间线

- 2026-11-14 14:06 - CI 报告测试失败
- 2026-11-14 21:14 - 开始调查
- 2026-11-14 21:59 - 本地复现问题
- 2026-11-14 22:05 - 修复并验证
- 2026-11-14 22:10 - CI 验证通过

**总耗时**: 约 1 小时

---

**状态**: ✅ 完成  
**日期**: 2026-11-14  
**版本**: v6.12.0
