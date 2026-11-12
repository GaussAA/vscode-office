import { $t } from "../../i18n/i18nConfig.ts";
import type { ParquetFailure } from "./parquetError";

interface ParquetErrorPaneProps {
  failure: ParquetFailure;
  fileName: string;
  copied: boolean;
  onCopy: (text: string) => void;
  onRevealFile: () => void;
  onRetry: () => void;
}

/** Named failure, likely cause, the raw detail and only the exits that can change the answer. */
export default function ParquetErrorPane({
  failure,
  fileName,
  copied,
  onCopy,
  onRevealFile,
  onRetry,
}: ParquetErrorPaneProps) {
  return (
    <div className="parquet-viewer__error-pane">
      {fileName && (
        <div className="parquet-viewer__error-file">
          <span className="codicon codicon-file" />
          <span className="parquet-viewer__error-file-name">{fileName}</span>
        </div>
      )}
      <div className="parquet-viewer__error" role="alert">
        <span className="codicon codicon-error" />
        <div className="parquet-viewer__error-body">
          <p className="parquet-viewer__error-title">
            {failure.kind === "other" ? failure.raw : $t("parquet.errorTitle")}
          </p>
          {failure.kind !== "other" && (
            <p className="parquet-viewer__error-text">
              {failure.kind === "codec"
                ? $t("parquet.errorCodec", { codec: failure.codec })
                : $t("parquet.errorTruncated")}
            </p>
          )}
          {failure.kind !== "other" && (
            <details className="parquet-viewer__error-raw">
              <summary>{$t("parquet.errorDetail")}</summary>
              <pre>{failure.raw}</pre>
            </details>
          )}
        </div>
        <div className="parquet-viewer__error-actions">
          <button
            type="button"
            className="parquet-viewer__pager-btn parquet-viewer__pager-btn--text"
            onClick={onRevealFile}
          >
            {$t("parquet.revealFile")}
          </button>
          {/* Retry only where retrying can change the answer: an unsupported codec is a
              property of the file, so offering Retry there sends the reader in a circle. */}
          {failure.kind !== "codec" && (
            <button type="button" className="parquet-viewer__pager-btn" onClick={onRetry}>
              {$t("common.retry")}
            </button>
          )}
          <button
            type="button"
            className="parquet-viewer__pager-btn"
            onClick={() => onCopy(failure.raw)}
            title={copied ? $t("common.copied") : $t("parquet.copyError")}
            aria-label={copied ? $t("common.copied") : $t("parquet.copyError")}
          >
            <span className={`codicon ${copied ? "codicon-check" : "codicon-copy"}`} />
          </button>
        </div>
      </div>
    </div>
  );
}
