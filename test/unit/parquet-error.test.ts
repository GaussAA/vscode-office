import assert from "node:assert/strict";
import test from "node:test";
import { describeParquetFailure } from "@/react/view/parquet/parquetError";

/**
 * The error state used to show the parser's own words — `parquet file invalid (footer != PAR1)`
 * — and nothing else. These are the failures a parquet file actually produces in practice; a
 * mapping that guesses wrong is worse than the raw message, so anything unknown passes through.
 */

test("failure: a broken footer reads as a truncated file", () => {
  const failure = describeParquetFailure("parquet file invalid (footer != PAR1)");
  assert.equal(failure?.kind, "truncated");
  assert.equal(
    failure?.kind === "truncated" ? failure.raw : null,
    "parquet file invalid (footer != PAR1)",
  );
});

test("failure: an unsupported codec names the codec", () => {
  const failure = describeParquetFailure("parquet unsupported compression codec: ZSTD");
  assert.equal(failure?.kind, "codec");
  assert.equal(failure?.kind === "codec" ? failure.codec : null, "ZSTD");
});

test("failure: a file that was never parquet reads as truncated", () => {
  assert.equal(
    describeParquetFailure("not a parquet file: missing magic bytes")?.kind,
    "truncated",
  );
});

test("failure: an unrecognised message is passed through unchanged", () => {
  const failure = describeParquetFailure("Unexpected end of buffer");
  assert.equal(failure?.kind, "other");
  assert.equal(failure?.raw, "Unexpected end of buffer");
});

test("failure: no message, no failure", () => {
  assert.equal(describeParquetFailure(null), null);
  assert.equal(describeParquetFailure(undefined), null);
  assert.equal(describeParquetFailure("   "), null);
});
