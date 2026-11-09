#!/usr/bin/env node
/**
 * 代码重复检测脚本
 *
 * 使用 jscpd 检测项目中的重复代码：
 * - 识别复制粘贴的代码块
 * - 提供重复率报告
 * - 建议重构机会
 *
 * 用法：node scripts/check-duplicates.mjs [--threshold=5]
 */

import { execSync } from "node:child_process";

const JSCPD_AVAILABLE = (() => {
  try {
    execSync("npx jscpd --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

if (!JSCPD_AVAILABLE) {
  console.log("📦 Installing jscpd...\n");
  execSync("pnpm add -D jscpd", { stdio: "inherit" });
}

// 从命令行参数获取阈值
const args = process.argv.slice(2);
const thresholdArg = args.find((arg) => arg.startsWith("--threshold="));
const threshold = thresholdArg ? parseInt(thresholdArg.split("=")[1]) : 5;

console.log(`🔍 Checking for duplicate code (min ${threshold} tokens)...\n`);

try {
  // 配置 jscpd
  const config = {
    threshold,
    reporters: ["console"],
    ignore: [
      "**/node_modules/**",
      "**/dist/**",
      "**/*.test.ts",
      "**/*.test.tsx",
      "**/x-spreadsheet/**", // Vendored code
    ],
    format: ["typescript", "javascript", "tsx", "jsx"],
  };

  // 创建临时配置文件
  const { writeFileSync, unlinkSync } = await import("node:fs");
  const configPath = ".jscpd.json";
  writeFileSync(configPath, JSON.stringify(config, null, 2));

  try {
    const result = execSync("npx jscpd src/", {
      encoding: "utf-8",
      stdio: "pipe",
    });

    console.log(result);
    console.log("\n✅ Duplicate code check completed!");
    console.log("\n💡 Tips:");
    console.log("  • Extract common code into utility functions");
    console.log("  • Create shared components for UI patterns");
    console.log("  • Use inheritance or composition for similar logic");
  } finally {
    unlinkSync(configPath);
  }
} catch (error) {
  const output = error.stdout?.toString() || error.message;

  if (output.includes("duplications found")) {
    console.log(output);
    console.log("\n⚠️  Found duplicated code. Consider refactoring.");
  } else {
    console.error("❌ Error checking duplicates:");
    console.error(output);
    process.exit(1);
  }
}
