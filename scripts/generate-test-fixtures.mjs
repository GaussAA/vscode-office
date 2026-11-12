#!/usr/bin/env node
/**
 * 生成完整的测试 fixtures
 *
 * 用法：
 *   node scripts/generate-test-fixtures.mjs
 *   node scripts/generate-test-fixtures.mjs --category=parquet
 *   node scripts/generate-test-fixtures.mjs --category=spreadsheet
 *   node scripts/generate-test-fixtures.mjs --category=jsonl
 */
import { writeFileSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parquetWriteBuffer } from "hyparquet-writer";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const fixturesRoot = join(repoRoot, "test", "fixtures");

const args = process.argv.slice(2);
const categoryArg = args.find((arg) => arg.startsWith("--category="));
const targetCategory = categoryArg ? categoryArg.split("=")[1] : "all";

console.log("🚀 生成测试 fixtures...");
console.log(`   目标类别: ${targetCategory}`);

// ============================================================================
// Parquet 文件生成
// ============================================================================

function generateParquetFixtures() {
  const parquetDir = join(fixturesRoot, "parquet");
  mkdirSync(parquetDir, { recursive: true });

  console.log("\n📦 生成 Parquet fixtures...");

  // 1. SNAPPY 压缩（最常见，Spark 默认）
  const snappyPath = join(parquetDir, "snappy.parquet");
  if (!existsSync(snappyPath)) {
    const rows = 1000;
    const ids = new Int32Array(rows);
    const names = new Array(rows);
    const scores = new Float64Array(rows);
    for (let i = 0; i < rows; i++) {
      ids[i] = i + 1;
      names[i] = `user-${i % 100}`;
      scores[i] = Math.round((Math.random() * 100 + i / 10) * 100) / 100;
    }
    const buffer = parquetWriteBuffer({
      columnData: [
        { name: "id", data: ids, type: "INT32" },
        { name: "name", data: names, type: "STRING" },
        { name: "score", data: scores, type: "DOUBLE" },
      ],
      compression: "SNAPPY",
    });
    writeFileSync(snappyPath, new Uint8Array(buffer));
    console.log(`   ✅ snappy.parquet (${rows} 行, SNAPPY 压缩)`);
  } else {
    console.log(`   ⏭️  snappy.parquet 已存在`);
  }

  // 2. GZIP 压缩
  const gzipPath = join(parquetDir, "gzip.parquet");
  if (!existsSync(gzipPath)) {
    const rows = 500;
    const ids = new Int32Array(rows);
    const values = new Float64Array(rows);
    for (let i = 0; i < rows; i++) {
      ids[i] = i + 1;
      values[i] = Math.sin(i / 50) * 1000;
    }
    const buffer = parquetWriteBuffer({
      columnData: [
        { name: "id", data: ids, type: "INT32" },
        { name: "value", data: values, type: "DOUBLE" },
      ],
      compression: "GZIP",
    });
    writeFileSync(gzipPath, new Uint8Array(buffer));
    console.log(`   ✅ gzip.parquet (${rows} 行, GZIP 压缩)`);
  } else {
    console.log(`   ⏭️  gzip.parquet 已存在`);
  }

  // 3. 未压缩（兼容性基线）
  const uncompressedPath = join(parquetDir, "uncompressed.parquet");
  if (!existsSync(uncompressedPath)) {
    const rows = 300;
    const ids = new Int32Array(rows);
    const flags = new Array(rows);
    for (let i = 0; i < rows; i++) {
      ids[i] = i + 1;
      flags[i] = i % 2 === 0;
    }
    const buffer = parquetWriteBuffer({
      columnData: [
        { name: "id", data: ids, type: "INT32" },
        { name: "flag", data: flags, type: "BOOLEAN" },
      ],
      compression: "UNCOMPRESSED",
    });
    writeFileSync(uncompressedPath, new Uint8Array(buffer));
    console.log(`   ✅ uncompressed.parquet (${rows} 行, 无压缩)`);
  } else {
    console.log(`   ⏭️  uncompressed.parquet 已存在`);
  }

  // 4. LZ4 压缩
  const lz4Path = join(parquetDir, "lz4.parquet");
  if (!existsSync(lz4Path)) {
    const rows = 800;
    const ids = new Int32Array(rows);
    const texts = new Array(rows);
    for (let i = 0; i < rows; i++) {
      ids[i] = i + 1;
      texts[i] = `sample text row ${i} with some repeated content`;
    }
    const buffer = parquetWriteBuffer({
      columnData: [
        { name: "id", data: ids, type: "INT32" },
        { name: "text", data: texts, type: "STRING" },
      ],
      compression: "LZ4",
    });
    writeFileSync(lz4Path, new Uint8Array(buffer));
    console.log(`   ✅ lz4.parquet (${rows} 行, LZ4 压缩)`);
  } else {
    console.log(`   ⏭️  lz4.parquet 已存在`);
  }

  // 5. BROTLI 压缩
  const brotliPath = join(parquetDir, "brotli.parquet");
  if (!existsSync(brotliPath)) {
    const rows = 600;
    const ids = new Int32Array(rows);
    const messages = new Array(rows);
    for (let i = 0; i < rows; i++) {
      ids[i] = i + 1;
      messages[i] = `message-${i % 50}`;
    }
    const buffer = parquetWriteBuffer({
      columnData: [
        { name: "id", data: ids, type: "INT32" },
        { name: "message", data: messages, type: "STRING" },
      ],
      compression: "BROTLI",
    });
    writeFileSync(brotliPath, new Uint8Array(buffer));
    console.log(`   ✅ brotli.parquet (${rows} 行, BROTLI 压缩)`);
  } else {
    console.log(`   ⏭️  brotli.parquet 已存在`);
  }

  // 6. 空文件
  const emptyPath = join(parquetDir, "empty.parquet");
  if (!existsSync(emptyPath)) {
    const buffer = parquetWriteBuffer({
      columnData: [{ name: "id", data: new Int32Array(0), type: "INT32" }],
    });
    writeFileSync(emptyPath, new Uint8Array(buffer));
    console.log(`   ✅ empty.parquet (0 行)`);
  } else {
    console.log(`   ⏭️  empty.parquet 已存在`);
  }

  // 7. 单行文件
  const singleRowPath = join(parquetDir, "single-row.parquet");
  if (!existsSync(singleRowPath)) {
    const buffer = parquetWriteBuffer({
      columnData: [
        { name: "id", data: [1], type: "INT32" },
        { name: "name", data: ["only"], type: "STRING" },
      ],
    });
    writeFileSync(singleRowPath, new Uint8Array(buffer));
    console.log(`   ✅ single-row.parquet (1 行)`);
  } else {
    console.log(`   ⏭️  single-row.parquet 已存在`);
  }

  // 8. 单列文件
  const singleColPath = join(parquetDir, "single-column.parquet");
  if (!existsSync(singleColPath)) {
    const buffer = parquetWriteBuffer({
      columnData: [{ name: "value", data: [1, 2, 3, 4, 5], type: "INT32" }],
    });
    writeFileSync(singleColPath, new Uint8Array(buffer));
    console.log(`   ✅ single-column.parquet (5 行, 1 列)`);
  } else {
    console.log(`   ⏭️  single-column.parquet 已存在`);
  }

  // 9. 移动现有的 nested 文件
  const oldNestedPath = join(fixturesRoot, "parquet-list-column.parquet");
  const newNestedPath = join(parquetDir, "nested.parquet");
  if (existsSync(oldNestedPath) && !existsSync(newNestedPath)) {
    copyFileSync(oldNestedPath, newNestedPath);
    console.log(`   ✅ nested.parquet (从 parquet-list-column.parquet 复制)`);
  } else if (existsSync(newNestedPath)) {
    console.log(`   ⏭️  nested.parquet 已存在`);
  }

  // 10. 多行组 + 统计：列画像的「按行组回答」只有在多于一个组时才有意义
  const multiGroupPath = join(parquetDir, "multigroup.parquet");
  if (!existsSync(multiGroupPath)) {
    const rows = 3000;
    const ids = new Int32Array(rows);
    const names = new Array(rows);
    const scores = new Float64Array(rows);
    for (let i = 0; i < rows; i++) {
      ids[i] = i + 1;
      // 每 7 个空一个，统计里才有 null_count 可读
      names[i] = i % 7 === 0 ? null : `user-${i % 100}`;
      scores[i] = (i % 1000) / 10;
    }
    const buffer = parquetWriteBuffer({
      columnData: [
        { name: "id", data: ids, type: "INT32" },
        { name: "name", data: names, type: "STRING", nullable: true },
        { name: "score", data: scores, type: "DOUBLE" },
      ],
      rowGroupSize: 1000,
    });
    writeFileSync(multiGroupPath, new Uint8Array(buffer));
    console.log(`   ✅ multigroup.parquet (${rows} 行 / 3 个 row group / 含 NULL 列)`);
  } else {
    console.log(`   ⏭️  multigroup.parquet 已存在`);
  }

  // 11. 没有 row-group statistics：统计是 writer 可选的，「未写统计」必须是一种可断言的状态
  const noStatsPath = join(parquetDir, "nostats.parquet");
  if (!existsSync(noStatsPath)) {
    const rows = 2000;
    const ids = new Int32Array(rows);
    const names = new Array(rows);
    for (let i = 0; i < rows; i++) {
      ids[i] = i + 1;
      names[i] = i % 11 === 0 ? null : `user-${i % 50}`;
    }
    const buffer = parquetWriteBuffer({
      columnData: [
        { name: "id", data: ids, type: "INT32" },
        { name: "name", data: names, type: "STRING", nullable: true },
      ],
      rowGroupSize: 1000,
      statistics: false,
    });
    writeFileSync(noStatsPath, new Uint8Array(buffer));
    console.log(`   ✅ nostats.parquet (${rows} 行 / 2 个 row group / statistics: false)`);
  } else {
    console.log(`   ⏭️  nostats.parquet 已存在`);
  }

  // 12. 损坏文件
  const corruptedPath = join(parquetDir, "corrupted.parquet");
  if (!existsSync(corruptedPath)) {
    const text = new TextEncoder().encode("This is not a valid parquet file\n");
    writeFileSync(corruptedPath, text);
    console.log(`   ✅ corrupted.parquet (损坏文件)`);
  } else {
    console.log(`   ⏭️  corrupted.parquet 已存在`);
  }
}

// ============================================================================
// 表格文件生成
// ============================================================================

function generateSpreadsheetFixtures() {
  const spreadsheetDir = join(fixturesRoot, "spreadsheet");
  mkdirSync(spreadsheetDir, { recursive: true });

  console.log("\n📊 生成表格 fixtures...");

  // 1. 移动现有的 sample.csv
  const oldCsvPath = join(fixturesRoot, "workspace", "sample.csv");
  const newCsvPath = join(spreadsheetDir, "sample.csv");
  if (existsSync(oldCsvPath) && !existsSync(newCsvPath)) {
    copyFileSync(oldCsvPath, newCsvPath);
    console.log(`   ✅ sample.csv (从 workspace/ 复制)`);
  } else if (existsSync(newCsvPath)) {
    console.log(`   ⏭️  sample.csv 已存在`);
  }

  // 2. TSV 文件
  const tsvPath = join(spreadsheetDir, "sample.tsv");
  if (!existsSync(tsvPath)) {
    const content = `id\tname\tscore\tnote
1\talpha\t95.5\tfirst entry
2\tbeta\t87.3\tsecond entry
3\tgamma\t92.1\tthird entry
`;
    writeFileSync(tsvPath, content, "utf8");
    console.log(`   ✅ sample.tsv (4 行, Tab 分隔)`);
  } else {
    console.log(`   ⏭️  sample.tsv 已存在`);
  }

  // 3. UTF-8 with BOM
  const bomPath = join(spreadsheetDir, "utf8-bom.csv");
  if (!existsSync(bomPath)) {
    const bom = "\uFEFF";
    const content = `${bom}name,value,note
测试,100,中文内容
test,200,English content
テスト,300,日本語
`;
    writeFileSync(bomPath, content, "utf8");
    console.log(`   ✅ utf8-bom.csv (UTF-8 BOM, 多语言)`);
  } else {
    console.log(`   ⏭️  utf8-bom.csv 已存在`);
  }

  // 4. 无表头 CSV
  const noHeaderPath = join(spreadsheetDir, "no-header.csv");
  if (!existsSync(noHeaderPath)) {
    const content = `1,apple,10.5
2,banana,5.3
3,orange,7.8
`;
    writeFileSync(noHeaderPath, content, "utf8");
    console.log(`   ✅ no-header.csv (无表头)`);
  } else {
    console.log(`   ⏭️  no-header.csv 已存在`);
  }

  // 5. 空 CSV
  const emptyCsvPath = join(spreadsheetDir, "empty.csv");
  if (!existsSync(emptyCsvPath)) {
    writeFileSync(emptyCsvPath, "", "utf8");
    console.log(`   ✅ empty.csv (0 字节)`);
  } else {
    console.log(`   ⏭️  empty.csv 已存在`);
  }

  // 6. 只有表头
  const headerOnlyPath = join(spreadsheetDir, "header-only.csv");
  if (!existsSync(headerOnlyPath)) {
    writeFileSync(headerOnlyPath, "id,name,score\n", "utf8");
    console.log(`   ✅ header-only.csv (只有表头)`);
  } else {
    console.log(`   ⏭️  header-only.csv 已存在`);
  }

  // 7. 包含引号和换行的 CSV
  const quotesPath = join(spreadsheetDir, "quotes-newlines.csv");
  if (!existsSync(quotesPath)) {
    const content = `id,text,note
1,"Simple text",normal
2,"Text with ""nested quotes""",quoted
3,"Multi-line
text here",newline
4,"Comma, in text",comma
`;
    writeFileSync(quotesPath, content, "utf8");
    console.log(`   ✅ quotes-newlines.csv (引号和换行)`);
  } else {
    console.log(`   ⏭️  quotes-newlines.csv 已存在`);
  }

  // 8. 混合类型列
  const mixedTypesPath = join(spreadsheetDir, "mixed-types.csv");
  if (!existsSync(mixedTypesPath)) {
    const content = `id,mixed_column,note
1,100,number
2,text,string
3,2024-01-01,date
4,true,boolean
5,,empty
`;
    writeFileSync(mixedTypesPath, content, "utf8");
    console.log(`   ✅ mixed-types.csv (混合类型)`);
  } else {
    console.log(`   ⏭️  mixed-types.csv 已存在`);
  }

  console.log(
    "\n   ⚠️  注意：Excel 文件（.xlsx, .xls, .xlsm, .ods）需要手动创建或使用 Python/LibreOffice",
  );
  console.log("   建议：用 Excel/LibreOffice 打开 sample.csv 并另存为各种格式");
}

// ============================================================================
// JSONL 文件生成
// ============================================================================

function generateJsonlFixtures() {
  const jsonlDir = join(fixturesRoot, "jsonl");
  mkdirSync(jsonlDir, { recursive: true });

  console.log("\n📝 生成 JSONL fixtures...");

  // 1. 移动现有的 sample.jsonl
  const oldJsonlPath = join(fixturesRoot, "workspace", "sample.jsonl");
  const newJsonlPath = join(jsonlDir, "sample.jsonl");
  if (existsSync(oldJsonlPath) && !existsSync(newJsonlPath)) {
    copyFileSync(oldJsonlPath, newJsonlPath);
    console.log(`   ✅ sample.jsonl (从 workspace/ 复制)`);
  } else if (existsSync(newJsonlPath)) {
    console.log(`   ⏭️  sample.jsonl 已存在`);
  }

  // 2. 包含无效行的 JSONL
  const invalidPath = join(jsonlDir, "invalid-lines.jsonl");
  if (!existsSync(invalidPath)) {
    const lines = [
      '{"id":1,"status":"valid","message":"first entry"}',
      "{broken json without closing brace",
      '{"id":2,"status":"valid","message":"after error"}',
      "not json at all",
      '{"id":3,"status":"valid","nested":{"deep":{"value":true}}}',
      "",
      '{"id":4,"status":"valid","empty_line_above":true}',
    ];
    writeFileSync(invalidPath, lines.join("\n") + "\n", "utf8");
    console.log(`   ✅ invalid-lines.jsonl (包含 2 个无效行, 1 个空行)`);
  } else {
    console.log(`   ⏭️  invalid-lines.jsonl 已存在`);
  }

  // 3. Unicode 和特殊字符
  const unicodePath = join(jsonlDir, "unicode.jsonl");
  if (!existsSync(unicodePath)) {
    const lines = [
      '{"id":1,"emoji":"🎉🚀💻","chinese":"中文测试内容","english":"English content"}',
      '{"id":2,"japanese":"日本語のテスト","korean":"한국어 테스트","russian":"Русский текст"}',
      '{"id":3,"special":"tab\\there\\nnewline","quote":"He said \\"Hello\\""}',
      '{"id":4,"unicode_escape":"\\u4e2d\\u6587","mixed":"emoji🌟and中文andEnglish"}',
      '{"id":5,"array":["emoji🔥","中文","English","日本語"],"nested":{"value":"mixed内容🎈"}}',
    ];
    writeFileSync(unicodePath, lines.join("\n") + "\n", "utf8");
    console.log(`   ✅ unicode.jsonl (多语言 + Emoji + 转义字符)`);
  } else {
    console.log(`   ⏭️  unicode.jsonl 已存在`);
  }

  // 4. 深层嵌套
  const deepNestedPath = join(jsonlDir, "deep-nested.jsonl");
  if (!existsSync(deepNestedPath)) {
    const deep10 = {
      a: { b: { c: { d: { e: { f: { g: { h: { i: { j: "depth-10" } } } } } } } } },
    };
    const deep15 = {
      l1: {
        l2: {
          l3: {
            l4: {
              l5: {
                l6: {
                  l7: {
                    l8: {
                      l9: {
                        l10: {
                          l11: {
                            l12: {
                              l13: {
                                l14: {
                                  l15: "depth-15",
                                },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    };
    const lines = [
      JSON.stringify({ id: 1, depth: 10, data: deep10 }),
      JSON.stringify({ id: 2, depth: 15, data: deep15 }),
      JSON.stringify({
        id: 3,
        array_nested: [[[[["deep-array"]]]]],
      }),
    ];
    writeFileSync(deepNestedPath, lines.join("\n") + "\n", "utf8");
    console.log(`   ✅ deep-nested.jsonl (10层和15层嵌套)`);
  } else {
    console.log(`   ⏭️  deep-nested.jsonl 已存在`);
  }

  // 5. 大型条目（>500 节点，触发虚拟滚动）
  const largeEntryPath = join(jsonlDir, "large-entry.jsonl");
  if (!existsSync(largeEntryPath)) {
    const largeObject = { id: 1, type: "large", fields: {} };
    for (let i = 0; i < 600; i++) {
      largeObject.fields[`field_${i}`] = `value_${i}`;
    }
    const lines = [
      JSON.stringify({ id: 0, type: "normal", note: "small entry before large one" }),
      JSON.stringify(largeObject),
      JSON.stringify({ id: 2, type: "normal", note: "small entry after large one" }),
    ];
    writeFileSync(largeEntryPath, lines.join("\n") + "\n", "utf8");
    console.log(`   ✅ large-entry.jsonl (1 个 600+ 节点的条目)`);
  } else {
    console.log(`   ⏭️  large-entry.jsonl 已存在`);
  }

  // 6. 超长字符串（测试换行）
  const longStringPath = join(jsonlDir, "long-strings.jsonl");
  if (!existsSync(longStringPath)) {
    const longText = "Lorem ipsum dolor sit amet. ".repeat(50); // ~1400 字符
    const lines = [
      JSON.stringify({
        id: 1,
        short: "normal text",
        long: longText,
      }),
      JSON.stringify({
        id: 2,
        description: longText + longText, // ~2800 字符
        tags: ["tag1", "tag2"],
      }),
    ];
    writeFileSync(longStringPath, lines.join("\n") + "\n", "utf8");
    console.log(`   ✅ long-strings.jsonl (包含超长字符串)`);
  } else {
    console.log(`   ⏭️  long-strings.jsonl 已存在`);
  }

  // 7. 空文件
  const emptyPath = join(jsonlDir, "empty.jsonl");
  if (!existsSync(emptyPath)) {
    writeFileSync(emptyPath, "", "utf8");
    console.log(`   ✅ empty.jsonl (0 字节)`);
  } else {
    console.log(`   ⏭️  empty.jsonl 已存在`);
  }

  // 8. 混合类型的同名键
  const mixedKeysPath = join(jsonlDir, "mixed-key-types.jsonl");
  if (!existsSync(mixedKeysPath)) {
    const lines = [
      '{"id":1,"value":"string"}',
      '{"id":"string-id","value":100}',
      '{"id":true,"value":null}',
      '{"id":{"nested":"object"},"value":["array"]}',
    ];
    writeFileSync(mixedKeysPath, lines.join("\n") + "\n", "utf8");
    console.log(`   ✅ mixed-key-types.jsonl (同键不同类型)`);
  } else {
    console.log(`   ⏭️  mixed-key-types.jsonl 已存在`);
  }
}

// ============================================================================
// 更新 README
// ============================================================================

function updateReadme() {
  const readmePath = join(fixturesRoot, "README.md");
  const content = `# Test Fixtures

测试样例数据文件，覆盖三种支持的格式：Parquet、表格（CSV/TSV/Excel）、JSONL。

## 目录结构

\`\`\`
test/fixtures/
├── parquet/          # Parquet 格式样例
├── spreadsheet/      # 表格格式样例（CSV, TSV, Excel）
├── jsonl/            # JSONL 格式样例
└── workspace/        # 遗留文件（用于向后兼容）
\`\`\`

## Parquet 文件

| 文件 | 行数 | 列数 | 压缩格式 | 用途 |
|------|------|------|----------|------|
| \`snappy.parquet\` | 1000 | 3 | SNAPPY | 最常见压缩格式（Spark 默认） |
| \`gzip.parquet\` | 500 | 2 | GZIP | 通用压缩格式 |
| \`uncompressed.parquet\` | 300 | 2 | 无 | 兼容性基线 |
| \`lz4.parquet\` | 800 | 2 | LZ4 | 高性能压缩 |
| \`brotli.parquet\` | 600 | 2 | BROTLI | 高压缩比 |
| \`nested.parquet\` | 2 | 3 | - | 嵌套列（LIST, STRUCT） |
| \`empty.parquet\` | 0 | 1 | - | 空文件边界测试 |
| \`single-row.parquet\` | 1 | 2 | - | 单行边界测试 |
| \`single-column.parquet\` | 5 | 1 | - | 单列边界测试 |
| \`corrupted.parquet\` | - | - | - | 损坏文件错误处理 |

## 表格文件

| 文件 | 行数 | 格式 | 用途 |
|------|------|------|------|
| \`sample.csv\` | 3 | CSV | 基本 CSV 测试 |
| \`sample.tsv\` | 4 | TSV | Tab 分隔测试 |
| \`utf8-bom.csv\` | 4 | CSV (UTF-8 BOM) | BOM 头 + 多语言 |
| \`no-header.csv\` | 3 | CSV | 无表头 |
| \`empty.csv\` | 0 | CSV | 空文件 |
| \`header-only.csv\` | 1 | CSV | 只有表头 |
| \`quotes-newlines.csv\` | 4 | CSV | 引号转义 + 换行 |
| \`mixed-types.csv\` | 5 | CSV | 混合类型列 |

**注意**：Excel 文件（.xlsx, .xls, .xlsm, .ods）需要手动创建。建议用 Excel/LibreOffice 打开 \`sample.csv\` 并另存为各种格式。

## JSONL 文件

| 文件 | 行数 | 用途 |
|------|------|------|
| \`sample.jsonl\` | 3 | 基本 JSONL 测试 |
| \`invalid-lines.jsonl\` | 7 | 包含无效 JSON 行和空行 |
| \`unicode.jsonl\` | 5 | 多语言 + Emoji + 转义字符 |
| \`deep-nested.jsonl\` | 3 | 深层嵌套（10层、15层、数组嵌套） |
| \`large-entry.jsonl\` | 3 | 超大对象（600+ 节点，触发虚拟滚动） |
| \`long-strings.jsonl\` | 2 | 超长字符串（测试换行） |
| \`empty.jsonl\` | 0 | 空文件 |
| \`mixed-key-types.jsonl\` | 4 | 同键不同类型 |

## 生成命令

所有文件可通过以下命令重新生成：

\`\`\`bash
node scripts/generate-test-fixtures.mjs              # 生成全部
node scripts/generate-test-fixtures.mjs --category=parquet
node scripts/generate-test-fixtures.mjs --category=spreadsheet
node scripts/generate-test-fixtures.mjs --category=jsonl
\`\`\`

## 遗留兼容

\`workspace/\` 目录保留用于向后兼容，但新测试应使用分类后的目录。

---

**生成时间**: ${new Date().toISOString()}
`;

  writeFileSync(readmePath, content, "utf8");
  console.log("\n📄 更新 README.md");
}

// ============================================================================
// 主流程
// ============================================================================

try {
  if (targetCategory === "all" || targetCategory === "parquet") {
    generateParquetFixtures();
  }

  if (targetCategory === "all" || targetCategory === "spreadsheet") {
    generateSpreadsheetFixtures();
  }

  if (targetCategory === "all" || targetCategory === "jsonl") {
    generateJsonlFixtures();
  }

  if (targetCategory === "all") {
    updateReadme();
  }

  console.log("\n✅ 全部完成！");
  console.log("\n下一步：");
  console.log("  1. 检查生成的文件: ls -lh test/fixtures/*/");
  console.log("  2. 手动创建 Excel 文件（.xlsx, .xls, .ods）");
  console.log("  3. 运行测试验证: pnpm test");
  console.log("  4. UI 验证: pnpm verify:ui");
} catch (error) {
  console.error("\n❌ 错误:", error.message);
  process.exit(1);
}
