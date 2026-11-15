/**
 * Entry kind classification: the single source of truth for determining whether a text
 * fragment is empty, invalid JSON, too large to parse, or a valid JSON value.
 *
 * GLOSSARY: "Entry kind 判定只在一处做出" — this module is that one place.
 */
import { JSONL_MAX_LINE_BYTES } from "@/common/jsonlTypes";

/** The four mutually exclusive entry kinds. */
export type EntryKind = "empty" | "invalid" | "too-large" | "value";

/**
 * Complete classification result: kind, label, text, and byte size.
 * Both JSONL lines and JSON records feed raw text to this classifier.
 */
export interface EntryClassification {
  kind: EntryKind;
  /** Derived identity label, only present for "value" kind. */
  label?: string;
  /** Trimmed text ready for rendering. */
  text: string;
  /** UTF-8 byte size of the original text. */
  byteSize: number;
  /** Parsed value, only present for "value" kind. */
  value?: unknown;
  /** Parse error message, only present for "invalid" kind. */
  error?: string;
}

const encoder = new TextEncoder();

/**
 * Calculate UTF-8 byte size for a string.
 * This is the single byte-size algorithm used across JSONL and JSON preview.
 */
export function utf8ByteSize(text: string): number {
  return encoder.encode(text).length;
}

/**
 * Derive a human-friendly label from a parsed JSON value's top-level identity keys.
 *
 * A top-level identity key whose value is an object is still this entry's identity container
 * (agent transcripts commonly store `id: { query, ... }`). Look one level inside it, but never
 * descend into arbitrary nested objects: a child record's `id` is not this entry's identity.
 */
const LABEL_KEYS = [
  "id",
  "_id",
  "uuid",
  "key",
  "name",
  "title",
  "ts",
  "timestamp",
  "query_search",
] as const;

// When checking nested labels, title comes before key
const NESTED_LABEL_KEYS = ["query", "name", "title", "label", "id", "key"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

function scalarLabel(candidate: unknown): string | undefined {
  if (typeof candidate === "string") {
    const trimmed = candidate.trim();
    return trimmed ? truncate(trimmed, 40) : undefined;
  }
  if (
    typeof candidate === "number" ||
    typeof candidate === "bigint" ||
    typeof candidate === "boolean"
  ) {
    return String(candidate);
  }
  return undefined;
}

function deriveLabel(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  for (const key of LABEL_KEYS) {
    if (!(key in value)) continue;
    const candidate = value[key];
    const direct = scalarLabel(candidate);
    if (direct) return direct;
    if (Array.isArray(candidate)) {
      for (const item of candidate.slice(0, 3)) {
        const label = scalarLabel(item);
        if (label) return label;
      }
      continue;
    }
    if (isRecord(candidate)) {
      for (const nestedKey of NESTED_LABEL_KEYS) {
        const nested = scalarLabel(candidate[nestedKey]);
        if (nested) return nested;
      }
    }
  }
  return undefined;
}

/**
 * Classify a raw text fragment into one of four entry kinds.
 *
 * This is the single point where entry kind is determined. The decision order is:
 * 1. Empty (whitespace-only text)
 * 2. Too large (exceeds JSONL_MAX_LINE_BYTES before parsing)
 * 3. Invalid (JSON parse fails)
 * 4. Value (valid JSON)
 *
 * @param rawText The original text to classify (may include line terminators)
 * @param sizeLimit Optional byte size limit (defaults to JSONL_MAX_LINE_BYTES)
 * @returns Complete classification with kind, label, text, and byte size
 */
export function classifyEntry(
  rawText: string,
  sizeLimit = JSONL_MAX_LINE_BYTES,
): EntryClassification {
  // Normalize text: remove BOM and line terminators
  const text = rawText.replace(/^\uFEFF/, "").replace(/[\r\n]+$/, "");

  // 1. Empty line (whitespace-only becomes empty string)
  if (text.trim() === "") {
    return { kind: "empty", text: "", byteSize: 0 };
  }

  const byteSize = utf8ByteSize(text);

  // 2. Too large to parse
  if (byteSize > sizeLimit) {
    return { kind: "too-large", text, byteSize };
  }

  // 3. Try to parse as JSON
  try {
    const value = JSON.parse(text);
    const label = deriveLabel(value);
    return { kind: "value", text, byteSize, value, ...(label ? { label } : {}) };
  } catch (error) {
    // 4. Invalid JSON
    const errorMessage = error instanceof Error ? error.message : "Invalid JSON";
    return { kind: "invalid", text, byteSize, error: errorMessage };
  }
}
