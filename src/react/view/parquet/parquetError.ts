/**
 * Library errors are precise for whoever wrote the parser and useless for whoever opened the
 * file: the table used to show `parquet file invalid (footer != PAR1)` and nothing else. This
 * maps the handful of failures a parquet file can actually produce onto a sentence the reader
 * can act on, and keeps the original for the folding section underneath.
 *
 * The mapping is deliberately coarse. A wrong guess ("your file is truncated") costs more than
 * the raw message, so anything unrecognised falls through to `other` and shows as-is.
 */
export type ParquetFailure =
  | { kind: "truncated"; raw: string }
  | { kind: "codec"; codec: string; raw: string }
  | { kind: "other"; raw: string };

export function describeParquetFailure(message: string | null | undefined): ParquetFailure | null {
  const raw = (message ?? "").trim();
  if (!raw) return null;
  const codec = /unsupported compression codec:\s*([A-Za-z0-9_.-]+)/i.exec(raw);
  if (codec) return { kind: "codec", codec: codec[1], raw };
  // hyparquet reports a file that ended early, or was never parquet, in several ways that all
  // mean the same thing here: `footer != PAR1`, `invalid parquet file`, `not a parquet file`.
  if (/footer|PAR1|magic|not a parquet|invalid parquet/i.test(raw)) {
    return { kind: "truncated", raw };
  }
  return { kind: "other", raw };
}
