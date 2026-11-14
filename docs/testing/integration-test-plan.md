# 集成测试计划

## 已完成的单元测试覆盖

### 核心模块测试（547 个测试，100% 通过）

#### 1. 类型守卫工具 (44 个测试)

- ✅ 基础类型检查
- ✅ 对象和数组验证
- ✅ 属性存在性检查
- ✅ 枚举和联合类型
- ✅ 边界条件

#### 2. Excel 模块测试

- ✅ entryFormat 测试（44 个）
- ✅ excel_reader 功能测试
- ✅ workbookRows 测试
- ✅ excel_images 测试
- ✅ excel_protection 测试

#### 3. Parquet 模块测试

- ✅ parquetReducer 状态管理（32 个测试）
- ✅ useParquetDocument hook（16 个测试）
- ✅ useParquetSelection hook（15 个测试）
- ✅ 5 种压缩格式支持

#### 4. CSV/JSONL 测试

- ✅ CSV 边界场景（BOM/引号/换行）
- ✅ JSONL 复杂情况（无效行/Unicode/深层嵌套）

---

## ErrorBoundary 测试（待添加 React Testing Library）

由于项目当前未配置 React Testing Library，ErrorBoundary 的完整测试需要：

### 所需依赖

```json
{
  "@testing-library/react": "^14.0.0",
  "@testing-library/user-event": "^14.0.0",
  "@testing-library/jest-dom": "^6.0.0"
}
```

### 测试计划（已编写，待运行）

- ✅ 正常渲染测试（2 个）
- ✅ 错误捕获测试（4 个）
- ✅ 自定义 fallback 测试（2 个）
- ✅ 重置功能测试（2 个）
- ✅ 边界情况测试（3 个）
- ✅ 控制台日志测试（1 个）

**测试文件**: `src/react/components/__tests__/ErrorBoundary.test.tsx`（14 个测试）

---

## 集成测试建议

### 1. 端到端场景测试

#### Excel 文件处理流程

```typescript
describe("Excel File Processing Integration", () => {
  it("loads → displays → edits → saves a complete workflow", async () => {
    // 1. Load Excel file
    // 2. Display in grid
    // 3. Edit cells
    // 4. Save changes
    // 5. Verify output
  });
});
```

#### Parquet 文件处理流程

```typescript
describe("Parquet File Processing Integration", () => {
  it("loads → filters → sorts → navigates large dataset", async () => {
    // 1. Load Parquet file
    // 2. Apply column filters
    // 3. Sort by column
    // 4. Navigate pages
    // 5. Verify state consistency
  });
});
```

### 2. 错误恢复测试

```typescript
describe("Error Recovery Integration", () => {
  it("recovers from network errors", async () => {
    // Simulate network failure → retry → success
  });

  it("handles corrupt files gracefully", async () => {
    // Load corrupt file → show error → allow retry
  });
});
```

### 3. 性能测试

```typescript
describe("Performance Integration", () => {
  it("handles large Excel files (>10MB)", async () => {
    // Load large file
    // Measure render time
    // Verify memory usage
  });

  it("handles Parquet files with 1M+ rows", async () => {
    // Load large dataset
    // Verify virtual scrolling
    // Check pagination performance
  });
});
```

---

## 当前测试覆盖率总结

### 已测试模块（100% 通过）

- ✅ 类型守卫系统
- ✅ Excel 核心功能
- ✅ Parquet 状态管理
- ✅ CSV/JSONL 处理
- ✅ 工具函数

### 测试统计

- **总测试数**: 547 个
- **通过率**: 100%
- **新增测试**: +137 个（从 410 → 547）
- **覆盖率**: ~70%（估算）

### 待补充测试

1. **ErrorBoundary 组件测试**（需要 RTL）
   - 已编写 14 个测试
   - 需要安装依赖后运行

2. **集成测试**（端到端）
   - Excel 完整工作流
   - Parquet 完整工作流
   - 错误恢复场景
   - 性能基准测试

3. **视觉回归测试**（可选）
   - UI 组件快照
   - 布局一致性

---

## 下一步行动

### 立即可执行（无需额外依赖）

1. ✅ 继续添加更多单元测试
2. ✅ 性能基准测试脚本
3. ✅ 手动集成测试清单

### 需要配置后执行

1. ⏳ 安装 React Testing Library
2. ⏳ 运行 ErrorBoundary 测试
3. ⏳ 添加端到端测试框架（Playwright/Cypress）

### 长期改进

1. ⏳ 自动化性能监控
2. ⏳ 持续集成测试报告
3. ⏳ 代码覆盖率可视化

---

## 结论

**当前状态**: 任务 4 完成度 **70%**

- ✅ 核心功能单元测试完善（547 个测试）
- ✅ 类型安全测试覆盖
- ✅ 状态管理测试覆盖
- ⏳ ErrorBoundary 测试已编写（待 RTL 配置）
- ⏳ 集成测试计划已制定（待实施）

**建议优先级**:

1. 安装 RTL → 运行 ErrorBoundary 测试（+14 个测试）
2. 编写关键路径集成测试（+20-30 个测试）
3. 添加性能基准测试（+5-10 个测试）

**预计达到 80% 覆盖**: 完成上述第 1-2 项
