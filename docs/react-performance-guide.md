# React 性能优化实施指南

本文档记录了 vscode-office 项目中实施的 React 性能优化，以及如何应用这些优化技术。

---

## 📋 已实施的优化

### 1. React.memo 优化

#### ParquetCell 组件

**位置**: `src/react/view/parquet/parquetCell.tsx`

**优化前**:

```typescript
export function ParquetCell({ value, rowIndex, ... }: Props) {
  // 组件实现
}
```

**优化后**:

```typescript
export const ParquetCell = memo(function ParquetCell({
  value, rowIndex, ...
}: Props) {
  // 组件实现
}, (prevProps, nextProps) => {
  // 自定义比较：仅比较影响渲染的 props
  return (
    prevProps.value === nextProps.value &&
    prevProps.pageIndex === nextProps.pageIndex &&
    prevProps.position === nextProps.position &&
    prevProps.query === nextProps.query &&
    prevProps.rowIndex === nextProps.rowIndex &&
    prevProps.column === nextProps.column
    // onActivate 始终是新函数，但不影响渲染，所以跳过比较
  );
});
```

**收益**:

- 防止父组件更新时的不必要重渲染
- 对于大表格（数百个单元格），节省大量渲染时间
- **预期**: 20-30% 渲染性能提升

**何时使用自定义比较**:

- Props 中有函数（如回调），但函数不影响渲染输出
- 需要深度比较某些 props
- 默认浅比较不够精确

#### ParquetMetaBar 组件

**位置**: `src/react/view/parquet/ParquetMetaBar.tsx`

**优化**:

```typescript
export const ParquetMetaBar = memo(function ParquetMetaBar({
  rowCount, columnCount, ...
}: Props) {
  // 组件实现
});
```

**收益**:

- 使用默认浅比较
- 元数据很少变化，避免不必要渲染

---

## 🎯 优化决策指南

### 何时添加 React.memo

#### ✅ 适合 memo 的场景

1. **纯展示组件**
   - 只依赖 props 渲染
   - 没有复杂的内部状态
   - 例如：ParquetCell, ParquetMetaBar

2. **频繁渲染的组件**
   - 在列表中重复出现
   - 父组件频繁更新
   - 例如：表格单元格、列表项

3. **渲染成本高的组件**
   - 有复杂的计算
   - 渲染大量子元素
   - 例如：图表、大型数据可视化

#### ❌ 不适合 memo 的场景

1. **Props 经常变化**
   - memo 的比较成本可能超过重渲染成本
   - 例如：实时更新的组件

2. **有复杂内部状态**
   - 内部状态变化会触发渲染，memo 无法阻止
   - 例如：表单组件、带过滤器的列表

3. **很少重渲染的组件**
   - 优化收益很小
   - 例如：顶层布局组件

### 何时使用自定义比较函数

#### ✅ 需要自定义比较

1. **Props 包含函数**

   ```typescript
   // 函数 props 总是新引用，但可能不影响渲染
   memo(Component, (prev, next) => {
     return prev.data === next.data; // 只比较数据
     // 跳过 prev.onClick === next.onClick
   });
   ```

2. **需要深度比较**

   ```typescript
   memo(Component, (prev, next) => {
     return JSON.stringify(prev.data) === JSON.stringify(next.data);
   });
   ```

3. **优化精确度**
   ```typescript
   // 只比较真正影响渲染的 props
   memo(Component, (prev, next) => {
     return (
       prev.id === next.id && prev.visible === next.visible
       // 跳过不影响渲染的其他 props
     );
   });
   ```

#### ❌ 不需要自定义比较

1. **所有 props 都是原始值**
   - 默认浅比较足够

2. **比较逻辑复杂**
   - 比较成本可能超过渲染成本

---

## 🔧 useCallback 和 useMemo 最佳实践

### useCallback: 稳定函数引用

#### ✅ 何时使用

```typescript
// 1. 传递给 memo 组件的回调
const handleClick = useCallback(() => {
  doSomething(id);
}, [id]);

<MemoizedChild onClick={handleClick} />

// 2. 作为 useEffect 的依赖
const fetchData = useCallback(() => {
  // 获取数据
}, [params]);

useEffect(() => {
  fetchData();
}, [fetchData]);
```

#### ❌ 不需要使用

```typescript
// 1. 不传递给其他组件
const handleClick = () => {
  doSomething();
};

// 2. 每次都需要最新闭包
const handleClick = () => {
  console.log(stateValue); // 需要最新的 stateValue
};
```

### useMemo: 缓存计算结果

#### ✅ 何时使用

```typescript
// 1. 昂贵的计算
const sortedData = useMemo(() => {
  return data.sort((a, b) => a.value - b.value);
}, [data]);

// 2. 创建引用稳定的对象/数组
const config = useMemo(
  () => ({
    width: 100,
    height: 200,
  }),
  [],
); // 空依赖 = 只创建一次

// 3. 过滤大量数据
const filtered = useMemo(() => {
  return items.filter((item) => item.active);
}, [items]);
```

#### ❌ 不需要使用

```typescript
// 1. 简单计算
const doubled = useMemo(() => value * 2, [value]); // 过度优化

// 2. 已经是稳定引用
const constant = useMemo(() => SOME_CONSTANT, []); // 不必要
```

---

## 📊 性能监控

### 使用 React DevTools Profiler

```typescript
import { Profiler } from 'react';

function onRenderCallback(
  id: string,
  phase: 'mount' | 'update',
  actualDuration: number,
) {
  console.log(`${id} ${phase}: ${actualDuration.toFixed(2)}ms`);
}

<Profiler id="ParquetTable" onRender={onRenderCallback}>
  <ParquetTable />
</Profiler>
```

### 运行性能基准测试

```bash
# 运行所有测试（包括性能基准）
pnpm test

# 只运行性能测试
pnpm test benchmark
```

---

## 🎯 优化清单

### 组件优化

- [x] ParquetCell - React.memo + 自定义比较
- [x] ParquetMetaBar - React.memo
- [ ] 其他频繁渲染的组件

### 回调优化

- [x] Parquet.tsx - 大部分回调已使用 useCallback
- [ ] 检查是否有遗漏的情况

### 计算优化

- [x] Parquet.tsx - 关键计算已使用 useMemo
- [ ] 检查是否有昂贵计算未优化

### 其他优化

- [ ] 避免在渲染中创建对象/数组
- [ ] 优化列表渲染的 key
- [ ] 代码分割（后续阶段）

---

## 📈 性能基准结果

### 当前基线（Round 13）

| 测试           | 目标       | 状态 |
| -------------- | ---------- | ---- |
| 10k 行处理     | < 100ms    | ✅   |
| 100k 行过滤    | < 200ms    | ✅   |
| 1k 对象创建    | < 10ms     | ✅   |
| 10k 字符串拼接 | < 50ms     | ✅   |
| 10k 字符串搜索 | < 20ms     | ✅   |
| 数组切片       | < 5ms      | ✅   |
| 10k 数字求和   | < 10ms     | ✅   |
| 1k 数字排序    | < 10ms     | ✅   |
| 10k 字符串排序 | < 50ms     | ✅   |
| 大型嵌套对象   | < 50ms     | ✅   |
| JSON 解析      | < 100ms    | ✅   |
| JSON 序列化    | < 100ms    | ✅   |
| 数组操作回归   | 平均 < 5ms | ✅   |

---

## 🚀 后续优化计划

### 阶段 1（进行中）

- [x] 关键组件 memo
- [x] 性能基准测试
- [ ] 更多组件优化
- [ ] 对象创建优化

### 阶段 2（计划中）

- LRU 缓存实现
- Web Worker 集成
- 增量渲染
- 内存管理优化

### 阶段 3（计划中）

- 代码分割
- 懒加载
- 动态高度虚拟滚动
- 构建优化

---

## 📚 参考资源

- [React.memo 文档](https://react.dev/reference/react/memo)
- [useCallback 文档](https://react.dev/reference/react/useCallback)
- [useMemo 文档](https://react.dev/reference/react/useMemo)
- [React DevTools Profiler](https://react.dev/learn/react-developer-tools)

---

**文档版本**: 1.0  
**创建日期**: 2026-11-14  
**最后更新**: 2026-11-14
