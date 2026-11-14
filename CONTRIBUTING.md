# 贡献指南

感谢你对 vscode-office 项目的关注！本指南将帮助你了解如何为项目做出贡献。

---

## 📋 目录

- [行为准则](#行为准则)
- [开始之前](#开始之前)
- [开发环境设置](#开发环境设置)
- [开发流程](#开发流程)
- [代码规范](#代码规范)
- [测试要求](#测试要求)
- [提交规范](#提交规范)
- [Pull Request 流程](#pull-request-流程)
- [问题报告](#问题报告)

---

## 行为准则

### 我们的承诺

为了营造一个开放和友好的环境，我们承诺让每个人都能参与项目和社区，无论其经验水平、性别、性别认同和表达、性取向、残疾、外貌、体型、种族、民族、年龄、宗教或国籍如何。

### 我们的标准

**积极行为包括**：

- 使用友好和包容的语言
- 尊重不同的观点和经验
- 优雅地接受建设性批评
- 专注于对社区最有利的事情
- 对其他社区成员表示同理心

**不可接受的行为包括**：

- 使用性化的语言或图像
- 挑衅、侮辱或贬损性评论
- 公开或私下骚扰
- 未经许可发布他人的私人信息
- 其他在专业环境中被认为不适当的行为

---

## 开始之前

### 了解项目

1. 阅读 [README.md](../README.md) 了解项目概况
2. 查看 [项目改进总结](./project-improvement-summary.md) 了解最新进展
3. 浏览 [任务路线图](./tasks/improvement-roadmap.md) 了解未来计划

### 寻找贡献点

- 查看 [Issues](https://github.com/GaussAA/vscode-office/issues) 中标记为 `good first issue` 的问题
- 阅读 [任务路线图](./tasks/improvement-roadmap.md) 中的待办任务
- 提出你自己的改进想法

---

## 开发环境设置

### 必需工具

- **Node.js**: >= 18.0.0（推荐 20.x LTS）
- **pnpm**: >= 8.0.0
- **Git**: 最新稳定版
- **VS Code**: 最新稳定版（推荐）

### 克隆仓库

```bash
git clone https://github.com/GaussAA/vscode-office.git
cd vscode-office
```

### 安装依赖

```bash
pnpm install
```

### 验证环境

```bash
# 运行所有检查
pnpm check

# 单独运行各项检查
pnpm format:check  # 代码格式
pnpm lint          # 代码质量
pnpm typecheck     # 类型检查
pnpm test          # 测试
```

所有命令都应该通过（零警告，零错误）。

---

## 开发流程

### 1. 创建分支

```bash
# 从最新的 main 分支创建
git checkout main
git pull origin main
git checkout -b feature/your-feature-name
```

**分支命名规范**：

- `feature/` - 新功能
- `fix/` - Bug 修复
- `refactor/` - 代码重构
- `docs/` - 文档更新
- `test/` - 测试相关
- `perf/` - 性能优化

### 2. 进行开发

```bash
# 开发过程中经常运行测试
pnpm test

# 提交前运行完整检查
pnpm check
```

### 3. 提交更改

```bash
# 添加更改
git add .

# 提交（遵循提交规范）
git commit -m "feat: add new feature"

# 推送到远程
git push -u origin feature/your-feature-name
```

---

## 代码规范

### TypeScript 规范

```typescript
// ✅ 好的做法
export function calculateSum(numbers: number[]): number {
  return numbers.reduce((sum, num) => sum + num, 0);
}

// ❌ 避免
export function calculateSum(numbers: any): any {
  return numbers.reduce((sum: any, num: any) => sum + num, 0);
}
```

### 类型安全

1. **使用类型守卫代替类型断言**

```typescript
// ✅ 好的做法
if (hasProperty(value, "name") && typeof value.name === "string") {
  console.log(value.name); // TypeScript 知道类型
}

// ❌ 避免
console.log((value as { name: string }).name);
```

2. **必要的类型断言要添加注释**

```typescript
// Type assertion required: ExcelJS internal property access
const ws = worksheet as ExcelJS.Worksheet & { sheetProtection?: ... };
```

### React 规范

1. **使用函数组件和 Hooks**

```typescript
// ✅ 好的做法
export const MyComponent: React.FC<Props> = ({ data }) => {
  const [state, setState] = useState(initialState);
  return <div>{data}</div>;
};

// ❌ 避免类组件（除非需要 Error Boundary）
export class MyComponent extends React.Component { ... }
```

2. **使用 memo 优化性能**

```typescript
export const ExpensiveComponent = React.memo<Props>(({ data }) => {
  return <div>{expensiveRender(data)}</div>;
});
```

### 文件组织

```
src/
  react/
    view/
      parquet/
        Parquet.tsx           # 主组件
        parquetReducer.ts     # 状态管理
        useParquetDocument.ts # 自定义 hooks
        __tests__/            # 测试文件
          parquetReducer.test.ts
```

### 命名规范

- **文件名**: camelCase（如 `parquetReducer.ts`）
- **组件名**: PascalCase（如 `ParquetViewer`）
- **函数名**: camelCase（如 `calculateSum`）
- **常量**: UPPER_SNAKE_CASE（如 `ROW_HEIGHT`）
- **接口/类型**: PascalCase（如 `UserData`）

---

## 测试要求

### 测试覆盖

- **新功能**: 必须包含单元测试
- **Bug 修复**: 应包含回归测试
- **重构**: 确保现有测试通过

### 编写测试

```typescript
import { describe, it, expect } from "vitest";

describe("calculateSum", () => {
  it("should sum an array of numbers", () => {
    const result = calculateSum([1, 2, 3, 4]);
    expect(result).toBe(10);
  });

  it("should return 0 for empty array", () => {
    const result = calculateSum([]);
    expect(result).toBe(0);
  });

  it("should handle negative numbers", () => {
    const result = calculateSum([-1, -2, 3]);
    expect(result).toBe(0);
  });
});
```

### 运行测试

```bash
# 运行所有测试
pnpm test

# 运行特定测试文件
pnpm test parquetReducer

# 观察模式
pnpm test --watch
```

### 测试标准

- ✅ 所有测试必须通过
- ✅ 测试覆盖核心功能和边界情况
- ✅ 测试独立（不依赖执行顺序）
- ✅ 测试快速（单个测试 < 100ms）

---

## 提交规范

### Conventional Commits

我们使用 [Conventional Commits](https://www.conventionalcommits.org/) 规范。

**格式**：

```
<type>(<scope>): <subject>

<body>

<footer>
```

**Type**（必需）：

- `feat`: 新功能
- `fix`: Bug 修复
- `refactor`: 代码重构
- `docs`: 文档更新
- `test`: 测试相关
- `perf`: 性能优化
- `style`: 代码格式（不影响功能）
- `chore`: 构建/工具相关

**Scope**（可选）：

- `parquet`: Parquet 相关
- `excel`: Excel 相关
- `csv`: CSV 相关
- `ui`: UI 组件
- `types`: 类型定义

**示例**：

```bash
feat(parquet): add column sorting feature

Implement ascending and descending sort for Parquet columns.
Uses efficient in-memory sorting for datasets < 100k rows.

Closes #123
```

### 提交最佳实践

1. **原子提交** - 一个提交做一件事
2. **清晰描述** - 说明"做了什么"和"为什么"
3. **小提交** - 避免巨大的变更集
4. **测试通过** - 每个提交都应该通过测试

---

## Pull Request 流程

### 1. 创建 PR

- 填写 PR 模板（如果有）
- 提供清晰的标题和描述
- 链接相关 Issue
- 添加截图/GIF（如果是 UI 变更）

### 2. PR 描述模板

```markdown
## 变更说明

简要描述此 PR 做了什么。

## 变更类型

- [ ] 新功能
- [ ] Bug 修复
- [ ] 重构
- [ ] 文档更新
- [ ] 性能优化

## 测试

描述你如何测试了这些变更。

## 检查清单

- [ ] 代码遵循项目规范
- [ ] 添加了必要的测试
- [ ] 所有测试通过
- [ ] 更新了相关文档
- [ ] PR 标题遵循 Conventional Commits

## 截图（如适用）
```

### 3. Code Review

- 响应审查意见
- 进行必要的修改
- 保持讨论专业和建设性

### 4. 合并要求

- ✅ 至少一个维护者批准
- ✅ 所有检查通过（CI）
- ✅ 解决所有审查意见
- ✅ 与主分支无冲突

---

## 问题报告

### Bug 报告

使用 Bug 报告模板：

```markdown
**Bug 描述**
清晰简洁地描述问题。

**重现步骤**

1. 打开 '...'
2. 点击 '...'
3. 滚动到 '...'
4. 看到错误

**预期行为**
描述你期望发生什么。

**实际行为**
描述实际发生了什么。

**截图**
如果适用，添加截图帮助解释问题。

**环境**

- OS: [例如 Windows 11]
- VS Code 版本: [例如 1.85.0]
- 扩展版本: [例如 2.0.0]

**附加信息**
其他有助于解决问题的上下文。
```

### 功能请求

```markdown
**功能描述**
清晰简洁地描述你想要的功能。

**使用场景**
描述这个功能的使用场景和价值。

**建议方案**
如果有，描述你设想的实现方式。

**替代方案**
描述你考虑过的其他方案。

**附加信息**
其他相关信息或截图。
```

---

## 开发技巧

### 快速命令

```bash
# 格式化代码
pnpm format

# 运行完整检查
pnpm check

# 类型检查
pnpm typecheck

# 更新类型基线（仅在必要时）
pnpm typecheck:update
```

### 调试

1. 在 VS Code 中使用断点调试
2. 使用 `console.log` 临时调试（提交前删除）
3. 使用 React DevTools 检查组件

### 性能分析

```typescript
// 使用 React Profiler
import { Profiler } from 'react';

<Profiler id="MyComponent" onRender={onRenderCallback}>
  <MyComponent />
</Profiler>
```

---

## 资源

### 项目文档

- [类型守卫使用指南](./type-guards-guide.md)
- [类型守卫最佳实践](./type-guard-best-practices.md)
- [性能优化指南](./performance-optimization-guide.md)
- [集成测试计划](./testing/integration-test-plan.md)

### 外部资源

- [TypeScript 文档](https://www.typescriptlang.org/docs/)
- [React 文档](https://react.dev/)
- [Vitest 文档](https://vitest.dev/)

---

## 获得帮助

### 交流渠道

- **GitHub Issues**: 提问、报告 Bug、功能请求
- **GitHub Discussions**: 一般讨论、想法分享

### 问题？

如果你有任何问题：

1. 查看现有文档
2. 搜索已有的 Issues
3. 创建新 Issue 询问

---

## 许可

通过贡献代码，你同意你的贡献将按照项目的许可证授权。

---

## 致谢

感谢所有为 vscode-office 做出贡献的开发者！

你的贡献让这个项目变得更好。🎉

---

**最后更新**: 2026-11-14
