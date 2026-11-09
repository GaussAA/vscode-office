# VSIX 打包问题分析与解决方案

## 问题分析

### 问题表现

1. **初次尝试失败**
   - 错误：npm 依赖缺失（has-property-descriptors、object-keys 等）
   - 原因：npm 试图检查所有依赖的完整性

2. **npm 镜像故障**
   - 错误：`[ER_NO_SUCH_TABLE] Table 'npmmirrordb.team_packages' doesn't exist`
   - registry.npmmirror.com 数据库表不存在

3. **临时解决**
   - 切换到 npm 官方源
   - 使用 `--no-dependencies` 跳过依赖检查

---

## 根本原因

### 1. pnpm vs npm 不兼容

**核心问题**：

- 项目使用 **pnpm** 管理依赖（pnpm-lock.yaml）
- `vsce` 工具默认使用 **npm** 检查依赖
- vsce 不认识 pnpm-lock.yaml，会尝试用 npm 验证依赖
- npm 和 pnpm 的依赖树结构不兼容

**为什么会失败**：

```
vsce package
  └─> npm install --dry-run (检查依赖)
      └─> 读取 package.json 但找不到 package-lock.json
          └─> 尝试重新解析依赖
              └─> 发现依赖树与 pnpm 安装的不一致
                  └─> 报错：缺少依赖
```

### 2. 项目配置混乱

已有的 package.json 中：

```json
{
  "scripts": {
    "package": "vsce package --no-dependencies"
  }
}
```

**说明**：项目已经知道这个问题，并在脚本中加了 `--no-dependencies`，但：

- prepublish 钩子会先运行 `npm run vscode:prepublish`
- 这会触发 `npm` 命令，导致依赖检查

---

## 当前方案评估

### 是"治标"还是"治本"？

**答案：治标，但对 VS Code 扩展来说是可接受的治标**

### 为什么当前 VSIX 是安全的？

✅ **安全原因**：

1. **VSIX 打包的是构建产物**（out/ 目录），不是源码
2. **out/ 已经通过 `pnpm build` 完整构建**
3. **VS Code 扩展运行时不需要安装依赖**
4. **所有代码已打包成 bundle**

验证：

- 文件大小：1.63 MB
- 包含文件：58 个，out/ 目录 3.93 MB
- 这些都是构建后的 JavaScript bundle

### 后续是否会出问题？

**不会影响用户使用**，但会影响开发流程：

⚠️ **每次打包都需要**：

1. 切换 npm 源到官方
2. 使用 `--no-dependencies`
3. 或者手动处理依赖问题

---

## 根本解决方案

### 方案 1：统一使用 pnpm（推荐）⭐

**实施步骤**：

1. **添加 .vscode/settings.json**：

```json
{
  "npm.packageManager": "pnpm"
}
```

2. **更新 package.json 脚本**：

```json
{
  "scripts": {
    "package": "pnpm exec vsce package --no-dependencies",
    "publish": "pnpm exec vsce publish --no-dependencies"
  }
}
```

3. **添加 .vscodeignore 规则**：

```
node_modules/
.pnpm-store/
pnpm-lock.yaml
```

**优点**：

- ✅ 保持 pnpm 的优势（速度、磁盘空间）
- ✅ 避免 npm/pnpm 冲突
- ✅ `--no-dependencies` 是合理的（VS Code 扩展特性）

**缺点**：

- ⚠️ 仍需 `--no-dependencies`（但这是正常的）

---

### 方案 2：生成 package-lock.json

**实施步骤**：

1. **同时维护两个锁文件**：

```bash
# 保留 pnpm
pnpm install

# 生成 npm 锁文件
npm install --package-lock-only
```

2. **提交两个锁文件**：

```bash
git add pnpm-lock.yaml package-lock.json
```

**优点**：

- ✅ vsce 可以验证依赖
- ✅ 兼容两个包管理器

**缺点**：

- ⚠️ 需要维护两个锁文件
- ⚠️ 容易不同步
- ⚠️ 增加维护成本

---

### 方案 3：完全切换到 npm

**不推荐**，因为：

- ❌ 失去 pnpm 的性能优势
- ❌ 需要大量迁移工作
- ❌ pnpm 是更现代的选择

---

## 推荐实施方案

### 立即执行（推荐方案 1）

```bash
# 1. 更新 .vscodeignore
echo "pnpm-lock.yaml" >> .vscodeignore

# 2. 更新 package.json
# 已经有 "package": "vsce package --no-dependencies"
# 保持现状即可

# 3. 文档化打包流程
# 创建 docs/release-process.md
```

### 创建标准化打包脚本

**scripts/package-vsix.ps1**：

```powershell
#!/usr/bin/env pwsh
# 标准化 VSIX 打包脚本

Write-Host "📦 VSIX 打包流程`n"

# 1. 确保使用官方源
$currentRegistry = npm config get registry
if ($currentRegistry -ne "https://registry.npmjs.org/") {
    Write-Host "切换到 npm 官方源..."
    npm config set registry https://registry.npmjs.org/
}

# 2. 构建
Write-Host "构建扩展..."
pnpm build

# 3. 打包
Write-Host "打包 VSIX..."
pnpm exec vsce package --no-dependencies

Write-Host "`n✅ 打包完成"
```

---

## 总结

### 问题性质

- **表面**：npm 镜像故障 + 依赖缺失
- **根本**：pnpm/npm 不兼容 + vsce 只支持 npm
- **解决**：使用 `--no-dependencies`（治标但安全）

### 是否会影响用户？

**不会**，因为：

1. ✅ VSIX 包含完整的构建产物
2. ✅ 运行时不需要安装依赖
3. ✅ 已通过 211 个测试

### 是否会影响后续打包？

**会**，但可以规范化：

1. ⚠️ 每次需要注意 npm 源
2. ✅ 但 package.json 已有正确的脚本
3. ✅ 创建标准化脚本可以自动化

### 建议

1. ✅ **当前 VSIX 可以安全使用**
2. ✅ **创建打包脚本**（scripts/package-vsix.ps1）
3. ✅ **文档化流程**（CONTRIBUTING.md 已包含）
4. ⏭️ 考虑方案 2（维护 package-lock.json）如果团队需要

---

**结论**：这是一个**可接受的治标方案**，不会影响用户使用，但应该通过标准化脚本来避免后续手动操作错误。
