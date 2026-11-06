/**
 * Render a value of unknown shape as display text.
 *
 * The obvious `String(value)` is wrong here: on a value typed `unknown` it happily produces
 * `[object Object]`, so a YAML scalar that came back as a map, or an ExcelJS cell holding rich
 * text, silently renders as a placeholder instead of its content. Narrowing positively — and
 * having a defined answer for objects — is what `oxlint --type-aware`
 * (`typescript/no-base-to-string`) was pointing at.
 *
 * Objects fall back to JSON, which keeps the information visible and is what the parquet and
 * JSONL viewers already showed. `null`/`undefined` render as the empty string: every caller
 * puts this straight into a table cell.
 */
export function toDisplayText(value: unknown): string {
  if (value == null) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "symbol") {
    return value.toString();
  }
  if (typeof value === "function") {
    return `[function ${value.name || "anonymous"}]`;
  }
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    // Cyclic structures have no JSON form; a stable placeholder beats throwing in a render path.
    return "[object]";
  }
}
