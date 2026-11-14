import { createContext, memo, useContext, type ReactNode } from "react";
import { normalizeExternalUrl } from "@/common/externalLink";
import { $t } from "../../i18n/i18nConfig.ts";
import { handler } from "../../util/vscode.ts";
import { highlightRuns } from "../../common/highlight.ts";
import { formatCellValue, type ColumnCategory, type ParquetColumnInfo } from "./parquetParser.ts";
import { jsonPreviewText, tokenizeJson, type JsonToken } from "./parquetPreview.ts";

/** Icon per category. The category itself is decided once, in parquetParser.categorizeType. */
export const COLUMN_ICONS: Record<ColumnCategory, string> = {
  bool: "codicon-symbol-boolean",
  numeric: "codicon-symbol-numeric",
  string: "codicon-symbol-string",
  datetime: "codicon-symbol-event",
  structure: "codicon-symbol-structure",
  field: "codicon-symbol-field",
};

/** A row of the virtual body: the file's columns plus antd's `key`. */
export type TableRow = Record<string, unknown> & { key: string };

/** Keyboard cursor into the visible page: row is page-local, col indexes fileInfo.columns. */
export interface CellCursor {
  row: number;
  col: number;
}

/**
 * The cursor is delivered through context rather than through the memoised column definitions:
 * moving it then re-renders the cells without rebuilding every column definition.
 */
export const CursorContext = createContext<CellCursor | null>(null);

/** Wrap the matched runs of a cell value in <mark>, so a hit is visible in place. */
function highlightCell(text: string, needle: string): ReactNode {
  if (!needle) return text;
  const parts: ReactNode[] = [];
  highlightRuns(text, needle).forEach((run, position) => {
    if (!run.hit) {
      parts.push(run.text);
      return;
    }
    parts.push(
      <mark key={position} className="parquet-viewer__hit">
        {run.text}
      </mark>,
    );
  });
  return parts;
}

/**
 * One data cell.
 *
 * The cell is a roving tab stop: only the cursor cell has `tabIndex=0`. Arrow keys move real
 * focus here, and the aria-label gives screen readers the column, row and value.
 *
 * Memoized to prevent unnecessary re-renders in large tables.
 * Only re-renders when value, cursor position, or query changes.
 */
export const ParquetCell = memo(
  function ParquetCell({
    value,
    rowIndex,
    pageIndex,
    position,
    column,
    query,
    onActivate,
  }: {
    value: unknown;
    rowIndex: number;
    pageIndex: number;
    position: number;
    column: ParquetColumnInfo;
    query: string;
    onActivate: () => void;
  }) {
    const cursor = useContext(CursorContext);
    const isCursor = cursor?.row === pageIndex && cursor?.col === position;
    const kind = column.category;
    const isNull = value === null || value === undefined;
    // Only a complete http(s) value becomes a link. A description containing a URL stays a
    // description; the host validates the emitted URL again before opening anything.
    const externalUrl = isNull ? null : normalizeExternalUrl(value);
    const jsonText = isNull || externalUrl ? null : jsonPreviewText(value);
    const displayText = isNull
      ? $t("parquet.nullLabel")
      : externalUrl
        ? typeof value === "string"
          ? value.trim()
          : externalUrl
        : (jsonText ?? formatCellValue(value, column.type));
    const classes = [
      "parquet-viewer__cell",
      isNull
        ? "parquet-viewer__cell--null"
        : externalUrl
          ? "parquet-viewer__cell--link"
          : jsonText
            ? "parquet-viewer__cell--json"
            : kind === "bool"
              ? ""
              : `parquet-viewer__cell--${kind}`,
      kind === "bool" && !isNull && !externalUrl && !jsonText
        ? value === true
          ? "parquet-viewer__cell--bool-true"
          : "parquet-viewer__cell--bool-false"
        : "",
      isCursor ? "parquet-viewer__cell--cursor" : "",
    ]
      .filter(Boolean)
      .join(" ");
    const labelText = displayText.length > 160 ? `${displayText.slice(0, 160)}…` : displayText;
    const openLink = () => {
      if (externalUrl) handler.emit("openExternal", externalUrl);
    };
    const content = isNull ? (
      $t("parquet.nullLabel")
    ) : externalUrl ? (
      <a
        className="parquet-viewer__cell-link"
        href={externalUrl}
        target="_blank"
        rel="noopener noreferrer"
        tabIndex={-1}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          // Opening the link is the point of the click, but it must not be the *only* thing that
          // happens: without this the one value a reader most wants to copy was the only one the
          // inspector could never hold.
          onActivate();
          openLink();
        }}
        onAuxClick={(event) => event.preventDefault()}
      >
        {highlightCell(displayText, query.trim())}
      </a>
    ) : jsonText ? (
      tokenizeJson(jsonText).map((token: JsonToken, index) => (
        <span
          key={index}
          className={`parquet-viewer__json-token parquet-viewer__json-token--${token.type}`}
        >
          {highlightCell(token.text, query.trim())}
        </span>
      ))
    ) : (
      highlightCell(displayText, query.trim())
    );

    return (
      <span
        className={classes}
        data-cell={`${pageIndex}:${position}`}
        tabIndex={isCursor ? 0 : -1}
        aria-label={`${column.name}, row ${rowIndex + 1}: ${labelText}${externalUrl ? ", external link" : ""}`}
        aria-keyshortcuts={externalUrl ? "Enter" : undefined}
        onClick={onActivate}
        onKeyDown={(event) => {
          // The anchor is not a separate tab stop (one per URL cell would flood the grid);
          // Enter on the roving cell is the keyboard equivalent of clicking the link.
          if (externalUrl && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            event.stopPropagation();
            openLink();
          }
        }}
      >
        {content}
      </span>
    );
  },
  (prevProps, nextProps) => {
    // Custom comparison: only re-render if these specific props change
    return (
      prevProps.value === nextProps.value &&
      prevProps.pageIndex === nextProps.pageIndex &&
      prevProps.position === nextProps.position &&
      prevProps.query === nextProps.query &&
      prevProps.rowIndex === nextProps.rowIndex &&
      prevProps.column === nextProps.column
      // onActivate is always a new function, but we don't compare it
      // since it doesn't affect rendering
    );
  },
);
