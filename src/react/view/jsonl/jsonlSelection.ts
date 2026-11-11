import type { JsonlEntryDetail } from "../../../common/jsonlTypes.ts";
import {
  type ValueText,
  fullValueText,
  isComposite,
  pathToText,
  preview,
  readPathKey,
  typeLabel,
  valueAtPath,
} from "./jsonlFormat.ts";

/**
 * The read model behind the detail's bottom bar.
 *
 * Selection used to be four `useMemo`s inside `JsonlDetail`: which value is selected, how it
 * is addressed, how it previews, and whether a scalar root counts as selected without a tree
 * row. Those rules are pure, and the component is a poor place to test them; this module is
 * the seam.
 *
 * `readSelection` deliberately returns null for a composite root with no active key: there is
 * nothing to point the bar at yet. `readActiveValue` is the separate question "what would Copy
 * value copy" — the whole entry even when no row is selected.
 */
export interface JsonlSelection {
  value: unknown;
  /** Bar label: `L3` for a scalar root, `user.name` for a tree row. */
  panelPath: string;
  /** One line for the collapsed bar. */
  preview: string;
  /** `typeLabel(value)`, used by the bar's count chip. */
  typeLabel: string;
}

function lineLabel(index: number): string {
  return `L${index + 1}`;
}

function readPreview(value: unknown): string {
  if (isComposite(value)) return preview(value);
  const source = typeof value === "string" ? value : String(value);
  const firstLine = (source.slice(0, 400).trimStart().split("\n", 1)[0] ?? "").trim();
  return firstLine.length > 160 ? `${firstLine.slice(0, 160)}…` : firstLine;
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

/** The selected value and its bar labels, or null when there is no value to show. */
export function readSelection(
  entry: JsonlEntryDetail | null,
  activeKey: string | null,
  index: number,
  entryLabel?: string,
): JsonlSelection | null {
  if (entry?.kind !== "value") return null;
  // A composite root has no row to select; the bar waits for one. A scalar root has no row but
  // is unambiguously the value the user is looking at.
  if (!activeKey && isComposite(entry.value)) return null;

  const segments = activeKey ? readPathKey(activeKey) : [];
  const value = activeKey ? valueAtPath(entry.value, segments) : entry.value;
  const line = entryLabel ?? lineLabel(index);
  return {
    value,
    panelPath: activeKey ? pathToText(segments) : line,
    preview: readPreview(value),
    typeLabel: typeLabel(value),
  };
}

/** The value a copy action targets, even when no row is selected. */
export function readActiveValue(entry: JsonlEntryDetail | null, activeKey: string | null): unknown {
  if (entry?.kind !== "value") return undefined;
  return activeKey ? valueAtPath(entry.value, readPathKey(activeKey)) : entry.value;
}

/** Build the full text only when the panel is open; this is the expensive half. */
export function readPanel(selection: JsonlSelection): ValueText {
  return fullValueText(selection.value);
}

/**
 * A string's length is free, so the collapsed bar can count it. Every other value needs the
 * pretty-printed text, which `readPanel` builds only after the panel opens.
 */
export function collapsedChars(selection: JsonlSelection): number | null {
  return typeof selection.value === "string" ? selection.value.length : null;
}
