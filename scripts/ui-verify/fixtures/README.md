# Fixtures

`zstd.parquet` — 4 KB, 300 rows, two columns, **ZSTD** compressed. Taken from
[apache/parquet-testing](https://github.com/apache/parquet-testing) (Apache-2.0) and kept in
the repo because it is the exact case this fork exists for: upstream's `hyparquet` without
`hyparquet-compressors` fails on it with `parquet unsupported compression codec: ZSTD`.

The other fixtures (mixed 300-row and 250k-row) are generated at run time by
`fixtures.mjs` with `hyparquet-writer`, into `.ui-verify/`.
