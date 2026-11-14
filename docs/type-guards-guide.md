# 类型守卫使用指南

## 概述

`typeGuards.ts` 提供了一套类型守卫和工具函数，用于减少类型断言（`as`）的使用，提高类型安全性。

## 为什么需要类型守卫？

### 问题：类型断言不安全

```typescript
// ❌ 不安全：运行时可能失败
const obj = data as Record<string, unknown>;
const name = obj.name as string;
```

### 解决：类型守卫提供运行时检查

```typescript
// ✅ 安全：运行时验证 + 类型收窄
if (isObject(data) && hasStringProperty(data, "name")) {
  const name = data.name; // TypeScript 知道这是 string
}
```

## 基础类型守卫

### 检查基本类型

```typescript
import { isString, isNumber, isBoolean, isObject, isArray } from "@/common/typeGuards";

function processValue(value: unknown) {
  if (isString(value)) {
    console.log(value.toUpperCase()); // TypeScript 知道是 string
  } else if (isNumber(value)) {
    console.log(value.toFixed(2)); // TypeScript 知道是 number
  } else if (isObject(value)) {
    console.log(Object.keys(value)); // TypeScript 知道是对象
  }
}
```

### 检查空值

```typescript
import { isNullish, isNonEmptyString } from "@/common/typeGuards";

// 检查 null 或 undefined
if (isNullish(value)) {
  return "No value";
}

// 检查非空字符串
if (isNonEmptyString(input)) {
  // 确保不是空字符串
  processInput(input);
}
```

## 属性访问守卫

### 安全的属性检查

```typescript
import { hasProperty, hasStringProperty, hasNumberProperty } from "@/common/typeGuards";

// ❌ 旧方式：不安全
function getUserName(data: unknown): string {
  return (data as any).name || "Unknown";
}

// ✅ 新方式：类型安全
function getUserName(data: unknown): string {
  if (hasStringProperty(data, "name")) {
    return data.name; // TypeScript 知道 data.name 是 string
  }
  return "Unknown";
}
```

### 多属性检查

```typescript
// 检查对象结构
function isValidUser(data: unknown): data is { name: string; age: number } {
  return hasStringProperty(data, "name") && hasNumberProperty(data, "age");
}

if (isValidUser(data)) {
  console.log(`${data.name} is ${data.age} years old`);
}
```

## 安全的属性提取

### 使用安全的 getter 函数

```typescript
import { getStringProperty, getNumberProperty, getBooleanProperty } from "@/common/typeGuards";

// ❌ 旧方式：可能崩溃
const name = (data as any).name || "default";
const age = (data as any).age || 0;

// ✅ 新方式：始终安全
const name = getStringProperty(data, "name", "default");
const age = getNumberProperty(data, "age", 0);
const active = getBooleanProperty(data, "active", false);
```

### 处理配置对象

```typescript
function loadConfig(raw: unknown) {
  return {
    apiUrl: getStringProperty(raw, "apiUrl", "http://localhost"),
    timeout: getNumberProperty(raw, "timeout", 5000),
    debug: getBooleanProperty(raw, "debug", false),
  };
}
```

## 断言函数

### 验证必需值

```typescript
import { assertDefined, assertString, assertNumber } from "@/common/typeGuards";

function processUser(data: unknown) {
  // 抛出错误如果 data 是 null/undefined
  const user = assertDefined(data, "User data is required");

  // 抛出错误如果不是字符串
  const name = assertString(user.name, "User name must be a string");

  // 抛出错误如果不是数字
  const age = assertNumber(user.age, "User age must be a number");

  return { name, age };
}
```

## 穷尽性检查

### Switch 语句完整性

```typescript
import { assertNever } from "@/common/typeGuards";

type Action =
  | { type: "add"; value: number }
  | { type: "remove"; value: number }
  | { type: "reset" };

function reducer(state: number, action: Action): number {
  switch (action.type) {
    case "add":
      return state + action.value;
    case "remove":
      return state - action.value;
    case "reset":
      return 0;
    default:
      // 如果添加新的 action 类型但忘记处理，TypeScript 会报错
      return assertNever(action);
  }
}
```

## 重构示例

### 之前：使用类型断言

```typescript
function parseUserData(raw: unknown): User {
  const data = raw as Record<string, unknown>;
  return {
    name: data.name as string,
    age: data.age as number,
    email: data.email as string,
  };
}
```

### 之后：使用类型守卫

```typescript
import { hasStringProperty, hasNumberProperty } from "@/common/typeGuards";

function parseUserData(raw: unknown): User | null {
  if (
    !hasStringProperty(raw, "name") ||
    !hasNumberProperty(raw, "age") ||
    !hasStringProperty(raw, "email")
  ) {
    return null;
  }

  return {
    name: raw.name,
    age: raw.age,
    email: raw.email,
  };
}
```

## 最佳实践

### 1. 优先使用类型守卫而不是断言

```typescript
// ❌ 避免
const value = data as string;

// ✅ 推荐
if (isString(data)) {
  const value = data;
}
```

### 2. 使用安全的属性访问

```typescript
// ❌ 避免
const name = (obj as any).name;

// ✅ 推荐
const name = getStringProperty(obj, "name", "Unknown");
```

### 3. 组合类型守卫

```typescript
function isValidConfig(value: unknown): value is Config {
  return (
    isObject(value) &&
    hasStringProperty(value, "url") &&
    hasNumberProperty(value, "timeout") &&
    getBooleanProperty(value, "enabled", true)
  );
}
```

### 4. 提前返回

```typescript
function processData(data: unknown) {
  if (!isObject(data)) {
    return null;
  }

  if (!hasStringProperty(data, "id")) {
    return null;
  }

  // 现在可以安全地使用 data.id
  return processId(data.id);
}
```

## 性能考虑

类型守卫是轻量级的运行时检查：

- `typeof` 和 `Array.isArray()` 非常快
- 属性检查（`in` 操作符）也很快
- 相比类型断言导致的运行时错误，检查的开销微不足道

## 测试覆盖

所有类型守卫都有全面的单元测试：

```bash
pnpm test test/unit/type-guards.test.ts
```

44 个测试覆盖：

- 基础类型检查
- 属性检查和提取
- 断言函数
- 边界情况

## 迁移策略

### 渐进式重构

1. **识别高风险代码**：多次 `as` 断言的函数
2. **添加类型守卫**：从外部 API 边界开始
3. **添加测试**：确保行为不变
4. **逐步替换**：一次一个函数

### 优先级

1. 🔴 高优先级：外部数据解析（API、文件）
2. 🟡 中优先级：内部数据转换
3. 🟢 低优先级：已知安全的内部逻辑

## 总结

- ✅ 使用类型守卫代替类型断言
- ✅ 运行时安全 + 编译时类型检查
- ✅ 更好的错误处理
- ✅ 更容易测试
- ✅ 更清晰的代码意图
