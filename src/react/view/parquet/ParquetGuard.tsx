import { $t } from "../../i18n/i18nConfig.ts";
import { formatBytes, previewLimitBytes } from "@/common/previewLimit";

interface ParquetGuardProps {
  tooLarge: { size: number; name: string; ext: string };
  onOpenAnyway: () => void;
  onRevealFile: () => void;
}

/** Refusal shown before an oversized virtual parquet would be decoded into the webview. */
export default function ParquetGuard({ tooLarge, onOpenAnyway, onRevealFile }: ParquetGuardProps) {
  return (
    <div className="parquet-viewer__too-large">
      <div className="parquet-viewer__too-large-panel">
        <h2 className="parquet-viewer__too-large-title">{$t("previewGuard.title")}</h2>
        <p className="parquet-viewer__too-large-body">
          {$t("previewGuard.body", {
            file: tooLarge.name,
            size: formatBytes(tooLarge.size),
            limit: formatBytes(previewLimitBytes(tooLarge.ext)),
          })}
        </p>
        <div className="parquet-viewer__too-large-actions">
          <button
            type="button"
            className="parquet-viewer__pager-btn parquet-viewer__too-large-open"
            onClick={onOpenAnyway}
          >
            {$t("previewGuard.open")}
          </button>
          {/* "Open anyway" is a memory bet. The file is on disk either way, so the second
              exit is the one that costs nothing: go look at it where it lives. */}
          <button
            type="button"
            className="parquet-viewer__pager-btn parquet-viewer__pager-btn--text"
            onClick={onRevealFile}
          >
            {$t("parquet.revealFile")}
          </button>
        </div>
      </div>
    </div>
  );
}
