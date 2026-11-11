import { $t } from "../../i18n/i18nConfig";
import { formatBytes } from "@/common/previewLimit";

interface ParquetMetaBarProps {
  rowCount: number;
  columnCount: number;
  fileSize?: number;
  codecs: string[];
  createdBy?: string;
}

export function ParquetMetaBar({
  rowCount,
  columnCount,
  fileSize,
  codecs,
  createdBy,
}: ParquetMetaBarProps) {
  return (
    <div className="parquet-viewer__meta">
      <span className="parquet-viewer__meta-item" title={$t("parquet.rows")}>
        <span className="codicon codicon-list-flat parquet-icon parquet-icon--rows" />
        <span className="parquet-viewer__meta-value">{rowCount.toLocaleString()}</span>
        <span className="parquet-viewer__meta-label">
          {rowCount === 1 ? $t("parquet.rowOne") : $t("parquet.rows")}
        </span>
      </span>
      <span className="parquet-viewer__meta-item" title={$t("parquet.columnsLabel")}>
        <span className="codicon codicon-symbol-field parquet-icon parquet-icon--columns" />
        <span className="parquet-viewer__meta-value">{columnCount}</span>
        <span className="parquet-viewer__meta-label">
          {columnCount === 1 ? $t("parquet.columnOne") : $t("parquet.columnsLabel")}
        </span>
      </span>
      {fileSize ? (
        <span className="parquet-viewer__meta-item" title={formatBytes(fileSize)}>
          <span className="codicon codicon-file-binary parquet-icon parquet-icon--size" />
          <span className="parquet-viewer__meta-value">{formatBytes(fileSize)}</span>
        </span>
      ) : null}
      {codecs.length > 0 && (
        <span className="parquet-viewer__meta-item" title={$t("parquet.codec")}>
          <span className="codicon codicon-file-zip parquet-icon parquet-icon--codec" />
          <span className="parquet-viewer__meta-value">{codecs.join(" · ")}</span>
          <span className="parquet-viewer__meta-label">{$t("parquet.codec")}</span>
        </span>
      )}
      {createdBy && (
        <span
          className="parquet-viewer__meta-item parquet-viewer__meta-item--author"
          title={createdBy}
        >
          <span className="codicon codicon-account parquet-icon parquet-icon--author" />
          <span className="parquet-viewer__meta-value">
            {createdBy.length > 40 ? `${createdBy.slice(0, 40)}…` : createdBy}
          </span>
        </span>
      )}
    </div>
  );
}
