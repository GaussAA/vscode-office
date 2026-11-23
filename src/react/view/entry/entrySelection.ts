import type { JsonlEntryDetail } from "../../../common/jsonlTypes.ts";
import {
  MAX_TEXT_CHARS,
  SUMMARY_CHARS,
  VALUE_PANEL_MAX_CHARS,
} from "../../../common/recordConstants.ts";
import {
  type ValueText,
  fullValueText,
  isComposite,
  pathToText,
  preview,
  readPathKey,
  summaryHead,
  typeLabel,
  valueAtPath,
} from "./entryFormat.ts";

/**
 * The read model behind the detail's bottom bar.
 *
 * Selection used to be four `useMemo`s inside `EntryDetail`: which value is selected, how it
 * is addressed, how it previews, and whether a scalar root counts as selected without a tree
 * row. Those rules are pure, and the component is a poor place to test them; this module is
 * the seam.
 *
 * Since ADR-0030 the bar is the only full-text channel, so it also covers the two cases that
 * used to have no panel at all: a composite root (the bar points at the whole record) and an
 * error line (`invalid` / `too-large`, whose raw text is the value).
 */
export interface JsonlSelection {
  value: unknown;
  /** Bar label: `L3` for a whole record, `user.name` for a tree row. */
  panelPath: string;
  /** One line for the collapsed bar. */
  preview: string;
  /** `typeLabel(value)`, used by the bar's count chip. */
  typeLabel: string;
  /** Whether `value` is a parsed JSON value or the line's raw text. */
  source: "value" | "text";
}

function lineLabel(index: number): string {
  return `L${index + 1}`;
}

function firstLine(text: string): string {
  const line = (text.slice(0, 400).trimStart().split("\n", 1)[0] ?? "").trim();
  return line.length > SUMMARY_CHARS ? `${line.slice(0, SUMMARY_CHARS)}…` : line;
}

function readPreview(value: unknown): string {
  if (isComposite(value)) return preview(value);
  const source = typeof value === "string" ? value : String(value);
  return firstLine(source);
}

/** What Copy path should put on the clipboard, independent of whether a row is selected. */
export function readCopyPath(
  entry: JsonlEntryDetail | null,
  activeKey: string | null,
  index: number,
  entryLabel?: string,
): string {
  const line = entryLabel ?? lineLabel(index);
  return activeKey ? `${line} › ${pathToText(readPathKey(activeKey))}` : line;
}

/** The selected value and its bar labels, or null when there is nothing to show. */
export function readSelection(
  entry: JsonlEntryDetail | null,
  activeKey: string | null,
  index: number,
  entryLabel?: string,
): JsonlSelection | null {
  if (!entry) return null;
  const line = entryLabel ?? lineLabel(index);

  // The raw text IS the content of an error line, and the panel is where it is read.
  if (entry.kind === "invalid" || entry.kind === "too-large") {
    return {
      value: entry.text,
      panelPath: line,
      preview: firstLine(entry.text),
      typeLabel: "text",
      source: "text",
    };
  }
  if (entry.kind !== "value") return null;

  const segments = activeKey ? readPathKey(activeKey) : [];
  const value = activeKey ? valueAtPath(entry.value, segments) : entry.value;
  return {
    value,
    panelPath: activeKey ? pathToText(segments) : line,
    preview: readPreview(value),
    typeLabel: typeLabel(value),
    source: "value",
  };
}

/** The value a copy action targets, even when no row is selected. */
export function readActiveValue(entry: JsonlEntryDetail | null, activeKey: string | null): unknown {
  if (!entry) return undefined;
  if (entry.kind === "invalid" || entry.kind === "too-large") return entry.text;
  if (entry.kind !== "value") return undefined;
  return activeKey ? valueAtPath(entry.value, readPathKey(activeKey)) : entry.value;
}

/**
 * Build the full text only when the panel is open; this is the expensive half.
 *
 * Two budgets, because the two sources are different: a parsed value may pretty-print to more
 * characters than its record, while the raw line is already bounded by the host at
 * `MAX_TEXT_CHARS`.
 */
export function readPanel(selection: JsonlSelection): ValueText {
  const limit = selection.source === "text" ? MAX_TEXT_CHARS : VALUE_PANEL_MAX_CHARS;
  return fullValueText(selection.value, limit);
}

/**
 * A string's length is free, so the collapsed bar can count it. Every other value needs the
 * pretty-printed text, which `readPanel` builds only after the panel opens.
 */
export function collapsedChars(selection: JsonlSelection): number | null {
  return typeof selection.value === "string" ? selection.value.length : null;
}

/** First `SUMMARY_CHARS` characters of the raw line, for the Raw tab and error bodies. */
export function rawSummary(entry: JsonlEntryDetail): { text: string; truncated: boolean } {
  return summaryHead(entry.text);
}
