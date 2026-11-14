import { memo } from "react";
import { $t } from "../../i18n/i18nConfig.ts";
import {
  INSPECT_PREVIEW_LIMIT,
  type ParquetInspection,
  type ParquetSelection,
} from "./useParquetInspection";

interface ParquetInspectorProps {
  inspected: ParquetSelection | null;
  inspection: ParquetInspection;
  hasRows: boolean;
  copied: boolean;
  onCopy: (text: string) => void;
  onClear: () => void;
  onFocusTable: () => void;
}

/**
 * The bottom value surface: a one-line selection bar, the expanded reader, and the settled
 * announcement. It has no selection state of its own; the caller owns the cell.
 *
 * Memoized because inspection state changes are infrequent relative to parent updates.
 */
const ParquetInspector = memo(function ParquetInspector({
  inspected,
  inspection,
  hasRows,
  copied,
  onCopy,
  onClear,
  onFocusTable,
}: ParquetInspectorProps) {
  return (
    <>
      {inspected && inspection.expanded && (
        <section
          className="parquet-viewer__inspector"
          aria-label={inspected.column}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              inspection.collapse();
              onFocusTable();
            }
          }}
        >
          <header className="parquet-viewer__inspector-head">
            <span className="parquet-viewer__inspector-name">{inspected.column}</span>
            {inspection.type ? (
              <span className="parquet-viewer__inspector-type">{inspection.type}</span>
            ) : null}
            <span className="parquet-viewer__inspector-meta">
              {$t("parquet.inspectMeta", {
                row: (inspected.row + 1).toLocaleString(),
                chars: inspection.size.chars.toLocaleString(),
                bytes: inspection.size.bytes.toLocaleString(),
              })}
            </span>
            <span className="parquet-viewer__inspector-actions">
              <button
                type="button"
                className="parquet-viewer__pager-btn parquet-viewer__pager-btn--text"
                aria-pressed={inspection.raw}
                onClick={inspection.toggleRaw}
              >
                {inspection.raw ? $t("parquet.inspectRaw") : $t("parquet.inspectFormatted")}
              </button>
              <button
                type="button"
                className="parquet-viewer__pager-btn"
                onClick={() => onCopy(inspection.full)}
                aria-label={$t("parquet.copyValue")}
              >
                <span className="codicon codicon-copy" />
              </button>
              <button
                type="button"
                className="parquet-viewer__pager-btn"
                onClick={() => {
                  inspection.collapse();
                  onFocusTable();
                }}
                aria-label={$t("parquet.inspectCollapse")}
              >
                <span className="codicon codicon-chevron-down" />
              </button>
            </span>
          </header>
          <pre className="parquet-viewer__inspector-body">
            {inspection.size.shown}
            {inspection.size.truncated
              ? $t("parquet.cappedSuffix", { max: INSPECT_PREVIEW_LIMIT.toLocaleString() })
              : ""}
          </pre>
        </section>
      )}

      {/* One announcement per settled selection. The visible bar updates on every arrow key,
          and aria-live on it queued a message per keystroke. */}
      <span className="parquet-viewer__sr-only" role="status" aria-live="polite">
        {inspected ? inspection.announcement : ""}
      </span>

      <div className="parquet-viewer__selection">
        {hasRows && inspected ? (
          <>
            <span className="parquet-viewer__selection-label">
              {inspected.column} · row {inspected.row + 1}
            </span>
            <button
              type="button"
              className="parquet-viewer__selection-value"
              aria-expanded={inspection.expanded}
              aria-label={$t("parquet.inspectExpand", { name: inspected.column })}
              onClick={inspection.toggleExpanded}
            >
              {inspection.text}
            </button>
            <button
              type="button"
              className="parquet-viewer__pager-btn"
              onClick={() => onCopy(inspection.full)}
              title={copied ? $t("common.copied") : $t("parquet.copyValue")}
              aria-label={copied ? $t("common.copied") : $t("parquet.copyValue")}
            >
              <span className={`codicon ${copied ? "codicon-check" : "codicon-copy"}`} />
            </button>
            <button
              type="button"
              className="parquet-viewer__pager-btn"
              onClick={onClear}
              title={$t("common.close")}
              aria-label={$t("common.close")}
            >
              <span className="codicon codicon-close" />
            </button>
          </>
        ) : hasRows ? (
          <span className="parquet-viewer__selection-hint">{$t("parquet.inspectHint")}</span>
        ) : null}
      </div>
    </>
  );
});

export default ParquetInspector;
