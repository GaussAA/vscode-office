#!/usr/bin/env node
/**
 * Bundle size analysis script
 *
 * Analyzes the built extension bundle to:
 * - Check total bundle size
 * - Identify large dependencies
 * - Warn if bundle exceeds thresholds
 *
 * Run after build: pnpm build && node scripts/bundle-analysis.mjs
 */

import { statSync, readdirSync } from "node:fs";
import { join } from "node:path";

const OUT_DIR = "dist";
const SIZE_THRESHOLD_MB = 10; // Warn if bundle > 10MB
const SINGLE_FILE_THRESHOLD_MB = 2; // Warn if any file > 2MB

function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

function analyzeDirectory(dir) {
  const files = [];
  let totalSize = 0;

  function walk(currentDir) {
    const items = readdirSync(currentDir, { withFileTypes: true });

    for (const item of items) {
      const fullPath = join(currentDir, item.name);

      if (item.isDirectory()) {
        walk(fullPath);
      } else {
        const stats = statSync(fullPath);
        const relativePath = fullPath.replace(dir + "/", "");
        files.push({ path: relativePath, size: stats.size });
        totalSize += stats.size;
      }
    }
  }

  walk(dir);
  return { files, totalSize };
}

console.log("📊 Bundle Size Analysis\n");
console.log("=".repeat(70));
console.log("");

try {
  const { files, totalSize } = analyzeDirectory(OUT_DIR);

  // Sort by size descending
  files.sort((a, b) => b.size - a.size);

  // Total size
  const totalMB = totalSize / (1024 * 1024);
  console.log(`📦 Total Bundle Size: ${formatBytes(totalSize)} (${totalMB.toFixed(2)} MB)`);

  if (totalMB > SIZE_THRESHOLD_MB) {
    console.log(`⚠️  WARNING: Bundle size exceeds ${SIZE_THRESHOLD_MB} MB threshold!`);
  } else {
    console.log(`✅ Bundle size is within limits (<${SIZE_THRESHOLD_MB} MB)`);
  }

  console.log("");
  console.log("📄 Top 10 Largest Files:");
  console.log("-".repeat(70));

  files.slice(0, 10).forEach((file, index) => {
    const sizeMB = file.size / (1024 * 1024);
    const warning = sizeMB > SINGLE_FILE_THRESHOLD_MB ? " ⚠️ " : "";
    console.log(
      `${(index + 1).toString().padStart(2)}. ${file.path.padEnd(50)} ${formatBytes(file.size).padStart(10)}${warning}`,
    );
  });

  console.log("");
  console.log("💡 Tips for reducing bundle size:");
  console.log("  • Use dynamic imports for large features");
  console.log("  • Check for duplicate dependencies");
  console.log("  • Consider code splitting");
  console.log("  • Remove unused exports");

  // Exit with error if over threshold
  if (totalMB > SIZE_THRESHOLD_MB) {
    process.exit(1);
  }
} catch (error) {
  console.error("❌ Error analyzing bundle:");
  console.error(error.message);
  console.error("\nMake sure to run 'pnpm build' first!");
  process.exit(1);
}
