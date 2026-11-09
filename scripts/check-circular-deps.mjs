#!/usr/bin/env node
/**
 * 检测项目中的循环依赖
 *
 * 循环依赖会导致：
 * - 模块加载顺序问题
 * - 运行时错误（undefined exports）
 * - 难以测试和重构
 *
 * 用法：node scripts/check-circular-deps.mjs
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";

const MADGE_AVAILABLE = (() => {
  try {
    execSync("npx madge --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

if (!MADGE_AVAILABLE) {
  console.log("📦 Installing madge...\n");
  execSync("pnpm add -D madge", { stdio: "inherit" });
}

console.log("🔍 Checking for circular dependencies...\n");

try {
  // 检查 src 目录的循环依赖
  const result = execSync("npx madge --circular --extensions ts,tsx src/", {
    encoding: "utf-8",
    stdio: "pipe",
  });

  if (result.trim()) {
    console.log("❌ Found circular dependencies:\n");
    console.log(result);
    process.exit(1);
  } else {
    console.log("✅ No circular dependencies found!");

    // 生成依赖图（可选）
    if (process.argv.includes("--graph")) {
      console.log("\n📊 Generating dependency graph...");
      execSync("npx madge --image deps-graph.svg --extensions ts,tsx src/", { stdio: "inherit" });
      console.log("✅ Graph saved to deps-graph.svg");
    }
  }
} catch (error) {
  console.error("❌ Error checking circular dependencies:");
  console.error(error.stdout?.toString() || error.message);
  process.exit(1);
}
