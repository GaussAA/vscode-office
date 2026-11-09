#!/usr/bin/env pwsh
<#
.SYNOPSIS
    标准化 VSIX 打包脚本

.DESCRIPTION
    解决 pnpm/npm 不兼容导致的打包问题：
    1. 确保使用 npm 官方源（避免镜像问题）
    2. 使用 pnpm 构建（保持一致性）
    3. 使用 --no-dependencies 打包（VS Code 扩展标准做法）

.EXAMPLE
    .\scripts\package-vsix.ps1
#>

Write-Host "`n📦 VSIX 打包流程`n"
Write-Host "=" * 70
Write-Host ""

# 1. 检查并切换 npm 源
Write-Host "1️⃣  检查 npm 源配置...`n"
$currentRegistry = npm config get registry

if ($currentRegistry -match "npmmirror|taobao") {
    Write-Host "   当前源: $currentRegistry"
    Write-Host "   切换到 npm 官方源..."
    npm config set registry https://registry.npmjs.org/
    Write-Host "   ✅ 已切换到官方源"
} else {
    Write-Host "   ✅ 已使用官方源: $currentRegistry"
}

Write-Host ""

# 2. 验证依赖
Write-Host "2️⃣  验证依赖...`n"
pnpm install --frozen-lockfile

if ($LASTEXITCODE -ne 0) {
    Write-Host "   ❌ 依赖安装失败"
    exit 1
}

Write-Host "   ✅ 依赖完整"
Write-Host ""

# 3. 构建
Write-Host "3️⃣  构建扩展...`n"
pnpm build

if ($LASTEXITCODE -ne 0) {
    Write-Host "   ❌ 构建失败"
    exit 1
}

Write-Host "   ✅ 构建完成"
Write-Host ""

# 4. 打包 VSIX
Write-Host "4️⃣  打包 VSIX...`n"
pnpm exec vsce package --no-dependencies

if ($LASTEXITCODE -ne 0) {
    Write-Host "   ❌ 打包失败"
    exit 1
}

Write-Host ""

# 5. 验证结果
$vsixFile = Get-ChildItem -Filter "*.vsix" | Sort-Object LastWriteTime -Descending | Select-Object -First 1

if ($vsixFile) {
    Write-Host "=" * 70
    Write-Host "✅ 打包成功！`n"
    Write-Host "文件: $($vsixFile.Name)"
    Write-Host "大小: $([math]::Round($vsixFile.Length / 1MB, 2)) MB"
    Write-Host "位置: $($vsixFile.FullName)"
    Write-Host ""
    Write-Host "安装测试:"
    Write-Host "  code --install-extension $($vsixFile.Name)"
    Write-Host ""
    Write-Host "上传到 Release:"
    Write-Host "  gh release upload <tag> $($vsixFile.Name) --repo GaussAA/vscode-office"
    Write-Host ""
    Write-Host "=" * 70
} else {
    Write-Host "❌ 找不到生成的 VSIX 文件"
    exit 1
}
