/**
 * Display helpers for one parquet cell.
 *
 * Polars/Hugging Face files often encode a list as a JSON *string* (`'["a","b"]'`) rather
 * than a parquet LIST, while other files use a real LIST. Both should read like data, not
 * like one green string. These helpers are pure so the cell and its unit tests agree on
 * what counts as a JSON container and how much of a long one is rendered.
 */

export type JsonTokenType =
  | "key"
  | "string"
  | "number"
  | "boolean"
  | "null"
  | "punct"
  | "ellipsis"
  /** Whitespace between tokens; only emitted when `preserveWhitespace` is on (the inspector). */
  | "space";

export interface JsonToken {
  type: JsonTokenType;
  text: string;
}

export interface JsonTokenizeOptions {
  /**
   * Emit the text between tokens as `space` tokens. The grid's one-line preview does not need
   * it; the expanded inspector renders indented JSON and must preserve newlines/indentation.
   */
  preserveWhitespace?: boolean;
  maxTokens?: number;
  maxChars?: number;
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

function stringifyJsonContainer(value: unknown, space: number): string | null {
  try {
    return (
      JSON.stringify(
        value,
        (_key, item: unknown) => {
          if (item instanceof Uint8Array)
            return `0x${Array.from(item, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
          if (item instanceof ArrayBuffer) {
            return `0x${Array.from(new Uint8Array(item), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
          }
          if (typeof item === "bigint") return item.toString();
          return item;
        },
        space,
      ) ?? null
    );
  } catch {
    return null;
  }
}

/** The parsed container behind a cell, or null when the cell is a scalar/plain string. */
function parseJsonContainer(value: unknown): unknown {
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
  return parsed;
}

/**
 * Canonical one-line JSON text for a container, or null when the cell is a scalar.
 *
 * A string is only parsed when its first non-space character is `[` or `{`: a description
 * that merely contains a bracketed phrase must stay plain text.
 */
export function jsonPreviewText(value: unknown): string | null {
  const parsed = parseJsonContainer(value);
  return parsed === null ? null : stringifyJsonContainer(parsed, 0);
}

/**
 * Indented JSON for the expanded inspector. A STRING containing a JSON object is parsed too:
 * Hugging Face/Polars files often store a whole object as a string, and "Formatted" must not
 * leave it as one escaped line (the grid already treats it as a container).
 */
export function jsonPrettyText(value: unknown): string | null {
  const parsed = parseJsonContainer(value);
  return parsed === null ? null : stringifyJsonContainer(parsed, 2);
}

/**
 * Split canonical JSON into colourisable tokens. The caller decides the class names; this
 * only labels syntax. Keys are strings followed by `:`, which is the one piece of context a
 * flat token list needs to distinguish `"name"` from `"alpha"`.
 */
export function tokenizeJson(text: string, options: JsonTokenizeOptions = {}): JsonToken[] {
  const tokenPattern =
    /("(?:\\.|[^"\\])*")|([{}[\],:])|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|(true|false|null)/g;
  const tokens: JsonToken[] = [];
  const maxTokens = options.maxTokens ?? MAX_PREVIEW_TOKENS;
  const maxChars = options.maxChars ?? MAX_PREVIEW_CHARS;
  let usedChars = 0;
  let lastEnd = 0;
  let match: RegExpExecArray | null;

  const appendEllipsis = () => {
    tokens.push({ type: "ellipsis", text: "…" });
  };
  /** Preserve the gap before the next token when the caller renders indented JSON. */
  const pushGap = (end: number) => {
    if (!options.preserveWhitespace || end <= lastEnd) return;
    tokens.push({ type: "space", text: text.slice(lastEnd, end) });
    lastEnd = end;
  };

  while ((match = tokenPattern.exec(text))) {
    pushGap(match.index);
    const raw = match[0];
    const end = match.index + raw.length;
    lastEnd = end;
    if (tokens.length >= maxTokens) {
      appendEllipsis();
      return tokens;
    }

    let type: JsonTokenType = "punct";
    if (match[1]) {
      const after = text.slice(end);
      type = /^\s*:/.test(after) ? "key" : "string";
    } else if (match[3]) {
      type = "number";
    } else if (match[4]) {
      type = match[4] === "null" ? "null" : "boolean";
    }

    const remaining = maxChars - usedChars;
    if (raw.length > remaining) {
      tokens.push({ type, text: `${raw.slice(0, Math.max(1, remaining - 1))}…` });
      return tokens;
    }
    tokens.push({ type, text: raw });
    usedChars += raw.length;
  }

  pushGap(text.length);
  return tokens;
}
