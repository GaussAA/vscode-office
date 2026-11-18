/**
 * The small "no data" shares in the schema rail and the profile header.
 *
 * `null` comes from row-group statistics and is exact for the whole file. `empty` comes from
 * the on-demand scan and covers nulls, empty strings, empty lists and empty binary; when the
 * scan stopped at its row cap the number describes a prefix, so it is marked with `~`.
 */
export interface ShareText {
  /** `null 12%` or `empty ~33%` — the rail badge. */
  badge: string;
  /** `12` or `<1` — the number the aria sentence interpolates (no `%`, no `~`). */
  percent: string;
  /** `12%` or `~33%` — the number the profile header renders after the label. */
  marked: string;
}

export function formatShare(
  label: "null" | "empty",
  ratio: number,
  approximate = false,
): ShareText {
  const percent = ratio <= 0 ? "0" : ratio < 0.01 ? "<1" : String(Math.round(ratio * 100));
  const mark = approximate ? "~" : "";
  return {
    badge: `${label} ${mark}${percent}%`,
    percent,
    marked: `${mark}${percent}%`,
  };
}
