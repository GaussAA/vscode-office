import { InputNumber } from "antd";
import { $t } from "../../i18n/i18nConfig.ts";
import type { ParquetFileInfo } from "./parquetParser";

interface ParquetPagerProps {
  fileInfo: ParquetFileInfo;
  page: number;
  totalPages: number;
  rowRange: string;
  pageLoading: boolean;
  rowJump: number | null;
  onRowJump: (value: number | null) => void;
  onJump: () => void;
  onGoToPage: (next: number | ((current: number) => number)) => void;
}

/** Footer navigation: page edges, a direct row jump, and the visible row range. */
export default function ParquetPager({
  fileInfo,
  page,
  totalPages,
  rowRange,
  pageLoading,
  rowJump,
  onRowJump,
  onJump,
  onGoToPage,
}: ParquetPagerProps) {
  return (
    <div className="parquet-viewer__pager">
      {pageLoading && (
        <span
          className="codicon codicon-loading codicon-modifier-spin parquet-viewer__pager-loading"
          aria-label={$t("parquet.loading")}
        />
      )}
      <button
        type="button"
        className="parquet-viewer__pager-btn"
        disabled={page <= 0}
        onClick={() => onGoToPage(0)}
        title={$t("parquet.firstPage")}
        aria-label={$t("parquet.firstPage")}
      >
        <span className="codicon codicon-arrow-left" />
      </button>
      <button
        type="button"
        className="parquet-viewer__pager-btn"
        disabled={page <= 0}
        onClick={() => onGoToPage((current) => Math.max(0, current - 1))}
        title={$t("parquet.previousPage")}
        aria-label={$t("parquet.previousPage")}
      >
        <span className="codicon codicon-chevron-left" />
      </button>
      <InputNumber
        size="small"
        className="parquet-viewer__row-jump"
        min={1}
        max={fileInfo.rowCount}
        disabled={fileInfo.rowCount === 0}
        precision={0}
        value={rowJump}
        placeholder={$t("parquet.rowLabel")}
        aria-label={$t("parquet.rowLabel")}
        onChange={(value) => onRowJump(typeof value === "number" ? value : null)}
        onPressEnter={onJump}
        // No jump on blur. Leaving a field is not a decision — retyping a number after looking
        // at the table used to navigate away half-way through. Only Enter or Go acts on it.
      />
      <button
        type="button"
        className="parquet-viewer__pager-btn parquet-viewer__pager-btn--text"
        data-row-jump-go
        disabled={fileInfo.rowCount === 0}
        onClick={onJump}
        title={$t("parquet.goToRow")}
      >
        {$t("parquet.go")}
      </button>
      <span className="parquet-viewer__pager-info">{rowRange}</span>
      {fileInfo.rowCount > 0 && (
        <span className="parquet-viewer__pager-page">
          {$t("parquet.pagePosition", {
            page: (page + 1).toLocaleString(),
            total: totalPages.toLocaleString(),
          })}
        </span>
      )}
      <button
        type="button"
        className="parquet-viewer__pager-btn"
        disabled={page >= totalPages - 1}
        onClick={() => onGoToPage((current) => Math.min(totalPages - 1, current + 1))}
        title={$t("parquet.nextPage")}
        aria-label={$t("parquet.nextPage")}
      >
        <span className="codicon codicon-chevron-right" />
      </button>
      <button
        type="button"
        className="parquet-viewer__pager-btn"
        disabled={page >= totalPages - 1}
        onClick={() => onGoToPage(totalPages - 1)}
        title={$t("parquet.lastPage")}
        aria-label={$t("parquet.lastPage")}
      >
        <span className="codicon codicon-arrow-right" />
      </button>
    </div>
  );
}
