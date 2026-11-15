#!/usr/bin/env node
import XLSX from "xlsx";
import { writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";

// 创建一个简单的工作簿
const wb = XLSX.utils.book_new();

// 创建数据
const data = [
  ["Name", "Age", "City"],
  ["Alice", 25, "Beijing"],
  ["Bob", 30, "Shanghai"],
  ["Charlie", 35, "Guangzhou"],
];

// 创建工作表
const ws = XLSX.utils.aoa_to_sheet(data);

// 添加到工作簿
XLSX.utils.book_append_sheet(wb, ws, "Test Sheet");

// 确保目录存在
const outputPath = "test/fixtures/test-simple.xlsx";
mkdirSync(dirname(outputPath), { recursive: true });

// 写入文件
const wbout = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });
writeFileSync(outputPath, wbout);

console.log(`✓ Created: ${outputPath}`);
