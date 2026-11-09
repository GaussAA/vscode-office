# 事件监听器内存泄漏修复指南

**问题**: 项目中有 133 处事件监听器注册，但只有 4 处清理，清理率仅 3%。

**修复状态**: 阶段 1 基础设施完成

---

## ✅ 已完成：阶段 1 - 基础设施

### 1. Handler 类增强 (`src/common/handler.ts`)

新增方法：

```typescript
// 移除单个监听器
off(event: string, callback: (content: any) => unknown): boolean

// 移除所有监听器
removeAllListeners(event?: string): this
```

### 2. SimpleEventEmitter 增强 (`src/common/simpleEventEmitter.ts`)

新增方法：

```typescript
removeAllListeners(event?: string): this
```

修改 `removeListener` 返回值为 `boolean`，自动清理空的 Set。

### 3. React Hooks (`src/react/hooks/useEventListener.ts`)

**useEventListener** - 自动清理 DOM 事件：

```typescript
useEventListener(window, "resize", handleResize);
useEventListener(element, "scroll", handleScroll);
```

**useHandlerEvent** - 自动清理 Handler 事件：

```typescript
useHandlerEvent(handler, "repositoryLoaded", (payload) => {
  // ...
});
```

---

## 🚧 待修复：阶段 2 - 组件迁移

### 优先级排序

| 组件                     | 监听器数量 | 优先级 | 预计工作量 |
| ------------------------ | ---------- | ------ | ---------- |
| GitHistory.tsx           | 17         | P0     | 2-3小时    |
| Excel.tsx                | 9          | P1     | 1-2小时    |
| index.ts (x-spreadsheet) | 6          | P1     | 1小时      |
| Jsonl.tsx                | 4          | P2     | 30分钟     |
| Parquet.tsx              | 2          | P2     | 20分钟     |

### GitHistory.tsx 修复清单

**Handler 事件（14个）** - 使用 `useHandlerEvent`：

- [ ] `repositoryLoaded`
- [ ] `commitsLoaded`
- [ ] `refreshDone`
- [ ] `pull`
- [ ] `push`
- [ ] `repoConfig`
- [ ] `actionDialogClosed`
- [ ] `filesCached`
- [ ] `diffReady`
- [ ] `compareReady`
- [ ] `cherryPickDone`
- [ ] `rebaseDone`
- [ ] `mergeDone`
- [ ] `resetDone`

**Window/DOM 事件（3个）** - 使用 `useEventListener`：

- [ ] `window.addEventListener('keydown', ...)`
- [ ] `content.addEventListener('scroll', ...)`
- [ ] 其他 DOM 事件

### 修复模式示例

**修复前（有泄漏）：**

```typescript
useEffect(() => {
  handler
    .on("repositoryLoaded", (payload) => {
      setBranches(payload.repoInfo.branches);
      // ...
    })
    .on("commitsLoaded", (payload) => {
      setCommits(payload.commits);
      // ...
    });
  // ❌ 没有清理！
}, []);
```

**修复后（自动清理）：**

```typescript
useHandlerEvent(handler, "repositoryLoaded", (payload) => {
  setBranches(payload.repoInfo.branches);
  // ...
});

useHandlerEvent(handler, "commitsLoaded", (payload) => {
  setCommits(payload.commits);
  // ...
});
```

**注意事项**：

1. 每个 `handler.on()` 变成独立的 `useHandlerEvent()` 调用
2. 如果回调依赖 state/props，需要将它们加入依赖数组
3. 链式调用 `.on().on()` 需要拆分

### Excel.tsx 修复清单

**已有清理（保持不变）：**

- ✅ `window.addEventListener('keydown')` - 已有清理

**需要修复（7个）：**

- [ ] `handler.on('open', ...)`
- [ ] `handler.on('saveDone', ...)`
- [ ] `spreadSheet.on('save', ...)`
- [ ] `spreadSheet.on('cell-selected', ...)`
- [ ] `spreadSheet.onSheetChange(...)`
- [ ] `spreadSheet.onOpenLink(...)`
- [ ] `spreadSheet.onProtectedCellDblClick(...)`

**特殊情况：** `spreadSheet` 是第三方对象，需要检查是否有对应的 `off` 方法。

### x-spreadsheet (index.ts) 修复策略

x-spreadsheet 是 vendored 的 JavaScript 代码，修复策略：

**选项 A（推荐）：** 在封装层清理

```typescript
useEffect(() => {
  const sheet = createSpreadsheet();

  // 注册事件
  sheet.on("change", handleChange);
  sheet.on("save", handleSave);

  return () => {
    // 清理所有监听器
    if (sheet.off) {
      sheet.off("change", handleChange);
      sheet.off("save", handleSave);
    }
    // 或者销毁整个实例
    sheet.destroy?.();
  };
}, []);
```

**选项 B：** 修改 x-spreadsheet 源码添加清理方法（工作量大，不推荐）

---

## 📊 预期效果

修复前：

- 监听器清理率: **3%** (4/133)
- 长时间使用内存持续增长
- 可能导致崩溃

修复后：

- 监听器清理率: **>95%**
- 内存稳定
- 消除崩溃风险

---

## 🧪 测试验证

### 单元测试

为 Hook 添加测试：

```typescript
// test/unit/useEventListener.test.ts
test("useEventListener cleans up on unmount", () => {
  const addSpy = vi.spyOn(window, "addEventListener");
  const removeSpy = vi.spyOn(window, "removeEventListener");

  const { unmount } = renderHook(() => useEventListener(window, "resize", () => {}));

  expect(addSpy).toHaveBeenCalledTimes(1);

  unmount();

  expect(removeSpy).toHaveBeenCalledTimes(1);
});
```

### 内存泄漏检测

使用 Chrome DevTools Memory Profiler：

1. 打开扩展的 webview
2. 打开 DevTools → Memory
3. 反复打开/关闭文件 10 次
4. 记录堆快照
5. 对比内存是否稳定

**目标**：10 次操作后内存增长 < 10%

---

## 📅 执行计划

### Week 1: 基础设施 + GitHistory

- [x] Day 1-2: 完成基础设施（Handler/Hooks）
- [ ] Day 3-5: 修复 GitHistory.tsx + 测试

### Week 2: 其他组件

- [ ] Day 1-2: 修复 Excel.tsx
- [ ] Day 3: 修复 x-spreadsheet 封装
- [ ] Day 4: 修复 Jsonl.tsx + Parquet.tsx
- [ ] Day 5: 全面测试 + 验证

### Week 3: 审查与文档

- [ ] Day 1-2: 内存泄漏测试
- [ ] Day 3: 代码审查
- [ ] Day 4: 文档更新
- [ ] Day 5: 发布

---

## 🔗 相关资源

- [React useEffect cleanup](https://react.dev/learn/synchronizing-with-effects#how-to-handle-the-effect-firing-twice-in-development)
- [Chrome Memory Profiler](https://developer.chrome.com/docs/devtools/memory-problems/)
- [Why Did You Render](https://github.com/welldone-software/why-did-you-render)

---

**最后更新**: 2026-11-09  
**状态**: 阶段 1 完成，阶段 2 进行中
