import { $t } from "../../i18n/i18nConfig.ts";
import { useMemo, useState, type RefObject } from "react";
import { chunkText, type ValueText } from "./entryFormat.ts";

interface Props {
  path: string;
  preview: string;
  typeLabel: string;
  /** Collapsed count: a string's length, or the opened panel's text length. */
  chars: number | null;
  open: boolean;
  panel: ValueText | null;
  /** Truncation fact to show above the text, if the value or the shipped line was cut. */
  notice?: string | null;
  toggleRef: RefObject<HTMLButtonElement | null>;
  onToggle: () => void;
}

/**
 * The docked selection bar under the tree. Presentational: the selection read model owns the
 * labels, and `EntryDetail` owns the keyboard and the open state.
 *
 * Since ADR-0030 this is the only full-text channel, so the body renders in chunks
 * (`content-visibility` skips what is outside the scrollport) and has its own expand toggle:
 * reading a multi-megabyte value in a 200px strip is not reading.
 */
export default function EntryValuePanel({
  path,
  preview,
  typeLabel,
  chars,
  open,
  panel,
  notice,
  toggleRef,
  onToggle,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const chunks = useMemo(() => (panel ? chunkText(panel.text) : []), [panel]);

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
        <div className={`jsonl-valuebar__body${expanded ? " jsonl-valuebar__body--expanded" : ""}`}>
          <div className="jsonl-valuebar__meta">
            {notice ? <span className="jsonl-valuebar__notice">{notice}</span> : <span />}
            <button
              type="button"
              className="jsonl-valuebar__expand"
              aria-expanded={expanded}
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? $t("jsonl.shrinkValue") : $t("jsonl.expandValue")}
            </button>
          </div>
          <div className="jsonl-valuebar__scroll" tabIndex={0}>
            {chunks.map((chunk, index) => (
              <div className="jsonl-valuebar__chunk" key={index}>
                {chunk}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
