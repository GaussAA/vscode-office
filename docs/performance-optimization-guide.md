# vscode-office 性能优化建议

本文档提供了针对 vscode-office 项目的性能优化建议和最佳实践。

---

## 📊 当前性能状况

### 已知性能特点

- **Parquet 文件**: 支持大型文件（1M+ 行），使用虚拟滚动
- **Excel 文件**: 通过 x-spreadsheet 渲染
- **CSV/JSONL**: 流式处理，支持大文件

### 已有的优化

1. ✅ Parquet 虚拟滚动（仅渲染可见行）
2. ✅ 分页加载（避免一次加载全部数据）
3. ✅ useCallback 和 useMemo 减少重渲染
4. ✅ 状态管理优化（reducer 替代多个 useState）

---

## 🎯 优化优先级

### 高优先级（立即可做）

1. **React 组件优化**
2. **内存管理改进**
3. **渲染性能优化**

### 中优先级（1-2 周）

1. **异步加载优化**
2. **缓存策略**
3. **Web Worker 集成**

### 低优先级（长期）

1. **代码分割**
2. **懒加载**
3. **构建优化**

---

## 🚀 具体优化建议

### 1. React 组件优化

#### 1.1 使用 React.memo 防止不必要的重渲染

```typescript
// 优化前
export const ParquetCell = (props: CellProps) => {
  return <div>{props.value}</div>;
};

// 优化后
export const ParquetCell = React.memo((props: CellProps) => {
  return <div>{props.value}</div>;
}, (prev, next) => {
  // 自定义比较函数
  return prev.value === next.value && prev.selected === next.selected;
});
```

**预期收益**: 减少 30-50% 的重渲染

#### 1.2 优化列表渲染的 key

```typescript
// 不好的做法
{rows.map((row, index) => (
  <Row key={index} data={row} /> // 使用 index 作为 key
))}

// 好的做法
{rows.map((row) => (
  <Row key={row.id} data={row} /> // 使用稳定的唯一标识
))}
```

**预期收益**: 改善 Diff 算法效率，减少 DOM 操作

#### 1.3 避免在渲染中创建新对象

```typescript
// 不好的做法
<Component style={{ margin: 10, padding: 5 }} />

// 好的做法
const COMPONENT_STYLE = { margin: 10, padding: 5 };
<Component style={COMPONENT_STYLE} />
```

**预期收益**: 减少内存分配，避免不必要的重渲染

### 2. 虚拟滚动优化

#### 2.1 动态计算可视区域

```typescript
// 当前实现（固定高度）
const ROW_HEIGHT = 28;
const visibleRows = Math.ceil(viewportHeight / ROW_HEIGHT);

// 优化建议（支持动态高度）
interface RowMeasurement {
  height: number;
  offset: number;
}

const measurements = useMemo(() => {
  const result: RowMeasurement[] = [];
  let offset = 0;

  rows.forEach((row) => {
    const height = calculateRowHeight(row); // 动态计算
    result.push({ height, offset });
    offset += height;
  });

  return result;
}, [rows]);
```

**预期收益**: 支持可变高度行，提升用户体验

#### 2.2 使用 Intersection Observer

```typescript
// 检测元素可见性，实现懒加载
const observeRow = useCallback((node: HTMLElement | null) => {
  if (!node) return;

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        // 加载数据
      }
    });
  });

  observer.observe(node);
  return () => observer.disconnect();
}, []);
```

**预期收益**: 更精确的可见性检测

### 3. 内存管理

#### 3.1 及时清理大对象

```typescript
useEffect(() => {
  // 加载大文件
  const data = loadLargeFile();

  return () => {
    // 清理
    data.dispose?.();
    // 或显式设置为 null 帮助 GC
  };
}, []);
```

#### 3.2 使用 WeakMap 缓存

```typescript
// 自动垃圾回收的缓存
const cache = new WeakMap<object, ComputedValue>();

function getComputedValue(key: object) {
  if (!cache.has(key)) {
    cache.set(key, expensiveComputation(key));
  }
  return cache.get(key)!;
}
```

**预期收益**: 减少内存泄漏风险

#### 3.3 分页数据管理

```typescript
// 当前：保留所有已加载页面
const allData = [...page1, ...page2, ...page3];

// 优化：仅保留当前页和相邻页
interface PageCache {
  [page: number]: RowData[];
}

const cache: PageCache = {};
const CACHE_SIZE = 3; // 当前页 + 前后各一页

function getPage(pageNum: number) {
  // 保留最近访问的 3 页
  const pagesToKeep = [pageNum - 1, pageNum, pageNum + 1];
  Object.keys(cache).forEach((key) => {
    if (!pagesToKeep.includes(Number(key))) {
      delete cache[Number(key)];
    }
  });
}
```

**预期收益**: 减少 70% 的内存占用（大文件场景）

### 4. 异步加载优化

#### 4.1 使用 Web Worker 处理大文件

```typescript
// worker.ts
self.addEventListener("message", (e) => {
  const { type, data } = e.data;

  if (type === "parse") {
    const result = parseParquetFile(data);
    self.postMessage({ type: "result", result });
  }
});

// 主线程
const worker = new Worker("worker.ts");

worker.postMessage({ type: "parse", data: fileData });

worker.addEventListener("message", (e) => {
  if (e.data.type === "result") {
    setData(e.data.result);
  }
});
```

**预期收益**: 避免阻塞 UI 线程，提升响应速度

#### 4.2 增量渲染

```typescript
// 分批渲染大量数据
function useIncrementalRender<T>(items: T[], batchSize = 100) {
  const [rendered, setRendered] = useState<T[]>([]);

  useEffect(() => {
    let index = 0;

    const renderBatch = () => {
      const batch = items.slice(index, index + batchSize);
      setRendered((prev) => [...prev, ...batch]);
      index += batchSize;

      if (index < items.length) {
        requestIdleCallback(renderBatch);
      }
    };

    renderBatch();
  }, [items, batchSize]);

  return rendered;
}
```

**预期收益**: 首屏加载速度提升 2-3x

### 5. 缓存策略

#### 5.1 计算结果缓存

```typescript
// 缓存昂贵的计算结果
const computedValue = useMemo(() => {
  return expensiveComputation(data);
}, [data]);

// 多级缓存
const cache = new Map<string, any>();

function getCachedValue(key: string, compute: () => any) {
  if (!cache.has(key)) {
    cache.set(key, compute());
  }
  return cache.get(key);
}
```

#### 5.2 LRU 缓存实现

```typescript
class LRUCache<K, V> {
  private cache = new Map<K, V>();

  constructor(private capacity: number) {}

  get(key: K): V | undefined {
    if (!this.cache.has(key)) return undefined;

    // 移到最前面
    const value = this.cache.get(key)!;
    this.cache.delete(key);
    this.cache.set(key, value);

    return value;
  }

  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.capacity) {
      // 删除最旧的
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }

    this.cache.set(key, value);
  }
}

// 使用
const fileCache = new LRUCache<string, FileData>(10);
```

**预期收益**: 提升重复访问的响应速度

### 6. 渲染性能

#### 6.1 防抖和节流

```typescript
// 防抖 - 延迟执行
const debouncedSearch = useMemo(
  () =>
    debounce((value: string) => {
      performSearch(value);
    }, 300),
  [],
);

// 节流 - 限制频率
const throttledScroll = useMemo(
  () =>
    throttle((event: Event) => {
      handleScroll(event);
    }, 16), // ~60fps
  [],
);
```

**预期收益**: 减少 80% 的不必要调用

#### 6.2 requestAnimationFrame 优化动画

```typescript
// 不好的做法
useEffect(() => {
  setInterval(() => {
    updatePosition();
  }, 16);
}, []);

// 好的做法
useEffect(() => {
  let frameId: number;

  const animate = () => {
    updatePosition();
    frameId = requestAnimationFrame(animate);
  };

  frameId = requestAnimationFrame(animate);

  return () => cancelAnimationFrame(frameId);
}, []);
```

**预期收益**: 更流畅的动画，更少的 CPU 占用

### 7. 代码分割

#### 7.1 动态导入

```typescript
// 按需加载大型组件
const ExcelViewer = React.lazy(() => import('./ExcelViewer'));

function App() {
  return (
    <Suspense fallback={<Loading />}>
      <ExcelViewer />
    </Suspense>
  );
}
```

**预期收益**: 减少初始加载大小 40-60%

#### 7.2 路由级代码分割

```typescript
const routes = [
  {
    path: "/excel",
    component: React.lazy(() => import("./pages/Excel")),
  },
  {
    path: "/parquet",
    component: React.lazy(() => import("./pages/Parquet")),
  },
];
```

---

## 📈 性能监控

### 1. 添加性能指标

```typescript
// 测量组件渲染时间
function measureRender(componentName: string) {
  const startTime = performance.now();

  return () => {
    const endTime = performance.now();
    console.log(`${componentName} 渲染耗时: ${endTime - startTime}ms`);
  };
}

// 使用
useEffect(() => {
  const cleanup = measureRender("Parquet");
  return cleanup;
}, []);
```

### 2. React DevTools Profiler

```typescript
import { Profiler } from 'react';

function onRenderCallback(
  id: string,
  phase: 'mount' | 'update',
  actualDuration: number,
) {
  console.log(`${id} ${phase} took ${actualDuration}ms`);
}

<Profiler id="Parquet" onRender={onRenderCallback}>
  <ParquetViewer />
</Profiler>
```

### 3. 性能基准测试

```typescript
// benchmark.test.ts
import { performance } from "perf_hooks";

describe("Performance benchmarks", () => {
  it("should load 10k rows in < 100ms", () => {
    const start = performance.now();

    const data = generateRows(10000);
    processData(data);

    const end = performance.now();
    expect(end - start).toBeLessThan(100);
  });
});
```

---

## 🎯 优化路线图

### 阶段 1: 快速胜利（1 周）

- [ ] 添加 React.memo 到关键组件
- [ ] 优化列表渲染的 key
- [ ] 添加防抖/节流
- [ ] 性能监控工具集成

**预期提升**: 20-30% 渲染性能

### 阶段 2: 深度优化（2-3 周）

- [ ] 实现 LRU 缓存
- [ ] Web Worker 集成
- [ ] 增量渲染
- [ ] 内存管理优化

**预期提升**: 40-50% 整体性能

### 阶段 3: 架构优化（1-2 月）

- [ ] 代码分割
- [ ] 懒加载策略
- [ ] 动态高度虚拟滚动
- [ ] 构建优化

**预期提升**: 60-70% 初始加载速度

---

## 🔧 工具推荐

### 性能分析

- **React DevTools Profiler** - 组件渲染分析
- **Chrome DevTools Performance** - 整体性能分析
- **Lighthouse** - 综合性能评分
- **webpack-bundle-analyzer** - 打包体积分析

### 监控

- **web-vitals** - Core Web Vitals 监控
- **performance.mark/measure** - 自定义性能标记

---

## 📊 性能指标目标

### 当前基线（需要测量）

- 首次内容绘制（FCP）: ?
- 最大内容绘制（LCP）: ?
- 首次输入延迟（FID）: ?
- 累积布局偏移（CLS）: ?

### 目标值

- FCP: < 1.8s
- LCP: < 2.5s
- FID: < 100ms
- CLS: < 0.1

### Parquet 特定指标

- 10k 行加载: < 200ms
- 100k 行加载: < 1s
- 滚动响应: < 16ms (60fps)
- 内存占用: < 100MB (100k 行)

---

## ⚠️ 注意事项

### 过早优化

- 先测量，再优化
- 关注热点路径
- 保持代码可读性

### 权衡

- 性能 vs 可维护性
- 内存 vs 速度
- 复杂度 vs 收益

### 最佳实践

1. ✅ 始终先建立性能基线
2. ✅ 一次优化一个问题
3. ✅ 测量优化效果
4. ✅ 保持测试通过
5. ✅ 记录优化决策

---

## 📚 参考资源

### React 性能

- [React 官方性能优化指南](https://react.dev/learn/render-and-commit)
- [useMemo 和 useCallback](https://react.dev/reference/react)

### 虚拟滚动

- [react-window](https://github.com/bvaughn/react-window)
- [react-virtualized](https://github.com/bvaughn/react-virtualized)

### Web Performance

- [Web Vitals](https://web.dev/vitals/)
- [Performance API](https://developer.mozilla.org/en-US/docs/Web/API/Performance)

---

## 🎯 总结

性能优化是一个持续的过程，需要：

1. **测量为先** - 建立基线，识别瓶颈
2. **渐进优化** - 从影响最大的开始
3. **持续监控** - 防止性能退化
4. **权衡取舍** - 性能与可维护性平衡

通过系统化的方法和持续的努力，我们可以显著提升 vscode-office 的性能，为用户提供更好的体验。

---

**文档版本**: 1.0  
**创建日期**: 2026-11-14  
**最后更新**: 2026-11-14
