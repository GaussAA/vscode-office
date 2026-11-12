import { $t } from "../../i18n/i18nConfig.ts";
import type { RefObject } from "react";
import { JSONL_VALUE_TEXT_LIMIT } from "../../../common/jsonlTypes.ts";
import type { ValueText } from "./entryFormat.ts";

interface Props {
  path: string;
  preview: string;
  typeLabel: string;
  /** Collapsed count: a string's length, or the opened panel's text length. */
  chars: number | null;
  open: boolean;
  panel: ValueText | null;
  toggleRef: RefObject<HTMLButtonElement | null>;
  onToggle: () => void;
}

/**
 * The docked selection bar under the tree. Presentational: the selection read model owns the
 * labels, and `EntryDetail` owns the keyboard and the open state.
 */
export default function EntryValuePanel({
  path,
  preview,
  typeLabel,
  chars,
  open,
  panel,
  toggleRef,
  onToggle,
}: Props) {
  return (
    <div className={`jsonl-valuebar${open ? " jsonl-valuebar--open" : ""}`}>
      <button
        ref={toggleRef}
        type="button"
        className="jsonl-valuebar__toggle"
        aria-expanded={open}
        aria-label={open ? $t("jsonl.hideValue") : $t("jsonl.showValue")}
        onClick={onToggle}
        title={open ? $t("jsonl.hideValue") : $t("jsonl.showValue")}
      >
        <span className="jsonl-valuebar__path">{path}</span>
        <span className="jsonl-valuebar__preview">{preview || "—"}</span>
        {chars !== null && chars !== 1 && (
          <span className="jsonl-valuebar__count">
            {typeLabel} · {$t("jsonl.valueChars", { count: chars.toLocaleString() })}
          </span>
        )}
        <span
          className={`codicon ${open ? "codicon-chevron-down" : "codicon-chevron-up"}`}
          aria-hidden="true"
        />
      </button>
      {open && panel && (
        <div className="jsonl-valuebar__body">
          {panel.truncated && (
            <div className="jsonl-valuebar__notice">
              {$t("jsonl.valueTruncated", {
                shown: JSONL_VALUE_TEXT_LIMIT.toLocaleString(),
                total: panel.chars.toLocaleString(),
              })}
            </div>
          )}
          <pre className="jsonl-valuebar__text" tabIndex={0}>
            {panel.text}
          </pre>
        </div>
      )}
    </div>
  );
}
