import { useCallback, useEffect, useMemo, useState } from "react";
import { $t } from "../../i18n/i18nConfig.ts";
import { formatCellValue } from "@/common/parquetCellFormat";
import type { ParquetColumnInfo } from "@/common/parquetReader";
import { ANNOUNCE_DELAY_MS } from "./parquetLayout";
import { jsonPrettyText, jsonPreviewText, tokenizeJson, type JsonToken } from "./parquetPreview";

/**
 * How much of a value the expanded panel renders. A LIST column can hold thousands of elements;
 * the panel is a reader, not a dump, and copy still receives the untruncated value.
 */
export const INSPECT_PREVIEW_LIMIT = 20_000;

export interface ParquetSelection {
  row: number;
  column: string;
  value: unknown;
}

export interface ParquetInspection {
  type: string | undefined;
  full: string;
  text: string;
  body: string;
  key: string;
  size: { chars: number; bytes: number; shown: string; truncated: boolean };
  /** Colourisable syntax tokens for the expanded body; null when it is not JSON. */
  tokens: JsonToken[] | null;
  expanded: boolean;
  raw: boolean;
  announcement: string;
  toggleRaw: () => void;
  toggleExpanded: () => void;
  collapse: () => void;
}

/**
 * Everything derived from the selected cell: the compact and expanded renderings, the copy text,
 * the expansion identity and the delayed screen-reader announcement. The viewer keeps only the
 * selection itself; the panel and the grid share this one model.
 */
export function useParquetInspection(
  inspected: ParquetSelection | null,
  columns: ParquetColumnInfo[],
): ParquetInspection {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [raw, setRaw] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  const type = inspected
    ? columns.find((column) => column.name === inspected.column)?.type
    : undefined;
  const full = inspected
    ? inspected.value === null || inspected.value === undefined
      ? $t("parquet.nullLabel")
      : formatCellValue(inspected.value, type)
    : "";
  // The grid already treats a JSON *string* as a container; the bar and panel must agree.
  const jsonCompact = inspected ? jsonPreviewText(inspected.value) : null;
  const jsonPretty = inspected ? jsonPrettyText(inspected.value) : null;
  const text = inspected ? (jsonCompact ?? full) : "";

  const body = useMemo(() => {
    if (!inspected) return "";
    if (jsonPretty !== null) {
      // A JSON string's raw form is the file's string (quoted and escaped), not the pretty
      // object; a real container's raw form is compact JSON.
      if (typeof inspected.value === "string") {
        return raw ? JSON.stringify(inspected.value) : jsonPretty;
      }
      return raw ? (jsonCompact ?? full) : jsonPretty;
    }
    if (typeof inspected.value === "string") {
      return raw ? JSON.stringify(inspected.value) : inspected.value;
    }
    if (inspected.value === null || inspected.value === undefined) return full;
    return full;
  }, [full, inspected, jsonCompact, jsonPretty, raw]);

  const size = useMemo(() => {
    const capped = body.slice(0, INSPECT_PREVIEW_LIMIT);
    return {
      chars: full.length,
      bytes: new TextEncoder().encode(full).length,
      shown: capped,
      truncated: body.length > capped.length,
    };
  }, [body, full]);

  const tokens = useMemo(() => {
    if (jsonPretty === null) return null;
    // No grid caps here: `shown` is already bounded by INSPECT_PREVIEW_LIMIT, and the body must
    // keep its newlines/indentation for the expanded reader.
    return tokenizeJson(size.shown, {
      preserveWhitespace: true,
      maxTokens: Number.POSITIVE_INFINITY,
      maxChars: Number.POSITIVE_INFINITY,
    });
  }, [jsonPretty, size.shown]);

  /**
   * Expansion is derived from the selection's identity, not reset by an effect: a new cell is a
   * new key, so it starts collapsed without a second render.
   */
  const key = inspected ? `${inspected.row}:${inspected.column}` : "";
  const expanded = key !== "" && expandedKey === key;

  useEffect(() => {
    if (!inspected) return;
    const timer = window.setTimeout(() => {
      setAnnouncement(`${inspected.column} · row ${inspected.row + 1} · ${text}`);
    }, ANNOUNCE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [inspected, text]);

  const toggleRaw = useCallback(() => setRaw((current) => !current), []);
  const toggleExpanded = useCallback(() => {
    setExpandedKey((current) => (current === key ? null : key));
  }, [key]);
  const collapse = useCallback(() => setExpandedKey(null), []);

  return {
    type,
    full,
    text,
    body,
    key,
    size,
    tokens,
    expanded,
    raw,
    announcement,
    toggleRaw,
    toggleExpanded,
    collapse,
  };
}
