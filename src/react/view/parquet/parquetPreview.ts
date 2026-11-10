/**
 * Display helpers for one parquet cell.
 *
 * Polars/Hugging Face files often encode a list as a JSON *string* (`'["a","b"]'`) rather
 * than a parquet LIST, while other files use a real LIST. Both should read like data, not
 * like one green string. These helpers are pure so the cell and its unit tests agree on
 * what counts as a JSON container and how much of a long one is rendered.
 */

export type JsonTokenType = "key" | "string" | "number" | "boolean" | "null" | "punct" | "ellipsis";

export interface JsonToken {
  type: JsonTokenType;
  text: string;
}

/** Enough tokens to explain a nested row at a glance; the title still has the full value. */
const MAX_PREVIEW_TOKENS = 80;
const MAX_PREVIEW_CHARS = 320;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  return (
    !(value instanceof Date) && !(value instanceof Uint8Array) && !(value instanceof ArrayBuffer)
  );
}

function stringifyJsonContainer(value: unknown): string | null {
  try {
    return (
      JSON.stringify(value, (_key, item: unknown) => {
        if (item instanceof Uint8Array)
          return `0x${Array.from(item, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
        if (item instanceof ArrayBuffer) {
          return `0x${Array.from(new Uint8Array(item), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
        }
        if (typeof item === "bigint") return item.toString();
        return item;
      }) ?? null
    );
  } catch {
    return null;
  }
}

/**
 * Canonical JSON text for a container, or null when the cell is a scalar.
 *
 * A string is only parsed when its first non-space character is `[` or `{`: a description
 * that merely contains a bracketed phrase must stay plain text.
 */
export function jsonPreviewText(value: unknown): string | null {
  let parsed: unknown = value;
  if (typeof value === "string") {
    const text = value.trim();
    if (!text.startsWith("[") && !text.startsWith("{")) return null;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      return null;
    }
  }
  if (!Array.isArray(parsed) && !isPlainRecord(parsed)) return null;
  return stringifyJsonContainer(parsed);
}

/**
 * Split canonical JSON into colourisable tokens. The caller decides the class names; this
 * only labels syntax. Keys are strings followed by `:`, which is the one piece of context a
 * flat token list needs to distinguish `"name"` from `"alpha"`.
 */
export function tokenizeJson(text: string): JsonToken[] {
  const tokenPattern =
    /("(?:\\.|[^"\\])*")|([{}[\],:])|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|(true|false|null)/g;
  const tokens: JsonToken[] = [];
  let usedChars = 0;
  let match: RegExpExecArray | null;

  const appendEllipsis = () => {
    tokens.push({ type: "ellipsis", text: "…" });
  };

  while ((match = tokenPattern.exec(text))) {
    const raw = match[0];
    if (tokens.length >= MAX_PREVIEW_TOKENS) {
      appendEllipsis();
      return tokens;
    }

    let type: JsonTokenType = "punct";
    if (match[1]) {
      const after = text.slice(tokenPattern.lastIndex);
      type = /^\s*:/.test(after) ? "key" : "string";
    } else if (match[3]) {
      type = "number";
    } else if (match[4]) {
      type = match[4] === "null" ? "null" : "boolean";
    }

    const remaining = MAX_PREVIEW_CHARS - usedChars;
    if (raw.length > remaining) {
      tokens.push({ type, text: `${raw.slice(0, Math.max(1, remaining - 1))}…` });
      return tokens;
    }
    tokens.push({ type, text: raw });
    usedChars += raw.length;
  }

  return tokens;
}
