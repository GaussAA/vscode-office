# Test Fixtures

测试样例数据文件，覆盖三种支持的格式：Parquet、表格（CSV/TSV/Excel）、JSONL。

## 目录结构

```
test/fixtures/
├── parquet/          # Parquet 格式样例
├── spreadsheet/      # 表格格式样例（CSV, TSV, Excel）
├── jsonl/            # JSONL 格式样例
└── workspace/        # 遗留文件（用于向后兼容）
```

## Parquet 文件

| 文件                    | 行数 | 列数 | 压缩格式 | 用途                         |
| ----------------------- | ---- | ---- | -------- | ---------------------------- |
| `snappy.parquet`        | 1000 | 3    | SNAPPY   | 最常见压缩格式（Spark 默认） |
| `gzip.parquet`          | 500  | 2    | GZIP     | 通用压缩格式                 |
| `uncompressed.parquet`  | 300  | 2    | 无       | 兼容性基线                   |
| `lz4.parquet`           | 800  | 2    | LZ4      | 高性能压缩                   |
| `brotli.parquet`        | 600  | 2    | BROTLI   | 高压缩比                     |
| `nested.parquet`        | 2    | 3    | -        | 嵌套列（LIST, STRUCT）       |
| `empty.parquet`         | 0    | 1    | -        | 空文件边界测试               |
| `single-row.parquet`    | 1    | 2    | -        | 单行边界测试                 |
| `single-column.parquet` | 5    | 1    | -        | 单列边界测试                 |
| `corrupted.parquet`     | -    | -    | -        | 损坏文件错误处理             |

## 表格文件

| 文件                  | 行数 | 格式            | 用途            |
| --------------------- | ---- | --------------- | --------------- |
| `sample.csv`          | 3    | CSV             | 基本 CSV 测试   |
| `sample.tsv`          | 4    | TSV             | Tab 分隔测试    |
| `utf8-bom.csv`        | 4    | CSV (UTF-8 BOM) | BOM 头 + 多语言 |
| `no-header.csv`       | 3    | CSV             | 无表头          |
| `empty.csv`           | 0    | CSV             | 空文件          |
| `header-only.csv`     | 1    | CSV             | 只有表头        |
| `quotes-newlines.csv` | 4    | CSV             | 引号转义 + 换行 |
| `mixed-types.csv`     | 5    | CSV             | 混合类型列      |

**注意**：Excel 文件（.xlsx, .xls, .xlsm, .ods）需要手动创建。建议用 Excel/LibreOffice 打开 `sample.csv` 并另存为各种格式。

## JSONL 文件

| 文件                    | 行数 | 用途                                |
| ----------------------- | ---- | ----------------------------------- |
| `sample.jsonl`          | 3    | 基本 JSONL 测试                     |
| `invalid-lines.jsonl`   | 7    | 包含无效 JSON 行和空行              |
| `unicode.jsonl`         | 5    | 多语言 + Emoji + 转义字符           |
| `deep-nested.jsonl`     | 3    | 深层嵌套（10层、15层、数组嵌套）    |
| `large-entry.jsonl`     | 3    | 超大对象（600+ 节点，触发虚拟滚动） |
| `long-strings.jsonl`    | 2    | 超长字符串（测试换行）              |
| `empty.jsonl`           | 0    | 空文件                              |
| `mixed-key-types.jsonl` | 4    | 同键不同类型                        |

## 生成命令

所有文件可通过以下命令重新生成：

```bash
node scripts/generate-test-fixtures.mjs              # 生成全部
node scripts/generate-test-fixtures.mjs --category=parquet
node scripts/generate-test-fixtures.mjs --category=spreadsheet
node scripts/generate-test-fixtures.mjs --category=jsonl
```

## 遗留兼容

`workspace/` 目录保留用于向后兼容，但新测试应使用分类后的目录。

---

**生成时间**: 2026-11-09T13:50:34.338Z
