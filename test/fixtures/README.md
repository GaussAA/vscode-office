# Fixtures

`parquet-list-column.parquet` — 2 rows, 1.5 KB. Covers the shapes the parquet column model
must survive:

| column | schema                         | row 1                    | row 2 |
| ------ | ------------------------------ | ------------------------ | ----- |
| `id`   | `UTF8`                         | `row-1`                  | null  |
| `tags` | `LIST<UTF8>`                   | `["ko", "en"]`           | null  |
| `meta` | `STRUCT<lang: UTF8, n: INT64>` | `{"lang": "ko", "n": 1}` | null  |

The LIST is written with both the modern `logical_type` and the deprecated
`converted_type`, matching what polars emits. That is why the unit test also builds a
logical-type-only `SchemaElement` by hand: the committed file alone would not cover that
path.

Reproduce with polars (the schema is the contract; the exact row values are not):

```python
import polars as pl

df = pl.DataFrame(
    {
        "id": ["row-1", "row-2"],
        "tags": [["ko", "en"], None],
        "meta": [{"lang": "ko", "n": 1}, None],
    }
)
df.write_parquet("parquet-list-column.parquet")
```

The UI harness serves this same file for the `parquet-nested-columns` scenario, so the
committed fixture is used by both the unit and DOM layers.
