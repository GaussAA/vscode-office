import type { ParquetColumnProfile, ParquetColumnScan } from "@/common/parquetProfileTypes";
import { $t } from "../../i18n/i18nConfig.ts";
import type { ParquetColumnInfo } from "./parquetParser";

interface ParquetColumnPanelProps {
  column: ParquetColumnInfo;
  /** The metadata answer for this column, if the host sent one. */
  stats?: ParquetColumnProfile;
  scan: ParquetColumnScan | null;
  loading: boolean;
  error: string | null;
  onScan: () => void;
  onClose: () => void;
}

/**
 * The profile panel, docked above the bottom bar.
 *
 * Same slot and the same reason as the value panel: it overlays the grid instead of shrinking
 * it, so opening it never re-pages the table under the reader. A scan is opt-in and bounded, so
 * the panel always says how many rows it actually covered — a prefix is not a total.
 */
export default function ParquetColumnPanel({
  column,
  stats,
  scan,
  loading,
  error,
  onScan,
  onClose,
}: ParquetColumnPanelProps) {
  const nullShare =
    stats?.state === "available" && stats.nullRatio !== undefined
      ? `${Math.round(stats.nullRatio * 100)}%`
      : null;
  return (
    <section className="parquet-viewer__profile" aria-label={$t("parquet.profileTitle")}>
      <header className="parquet-viewer__profile-head">
        <span className="parquet-viewer__profile-name">{column.name}</span>
        <span className="parquet-viewer__profile-type">{column.type}</span>
        {nullShare && <span className="parquet-viewer__profile-null">null {nullShare}</span>}
        {stats?.min !== undefined && stats.max !== undefined && (
          <span className="parquet-viewer__profile-range">
            {stats.min} … {stats.max}
          </span>
        )}
        <button
          type="button"
          className="parquet-viewer__pager-btn parquet-viewer__profile-close"
          onClick={onClose}
          aria-label={$t("common.close")}
        >
          <span className="codicon codicon-close" />
        </button>
      </header>
      {error ? (
        <p className="parquet-viewer__profile-note parquet-viewer__profile-note--error">{error}</p>
      ) : scan ? (
        <>
          <ol className="parquet-viewer__profile-list">
            {scan.top.map((entry) => (
              <li key={entry.value} className="parquet-viewer__profile-row">
                <span className="parquet-viewer__profile-value">{entry.value}</span>
                <span className="parquet-viewer__profile-count">
                  {entry.count.toLocaleString()}
                </span>
              </li>
            ))}
          </ol>
          <p className="parquet-viewer__profile-note">
            {$t("parquet.profileScanned", {
              scanned: scan.scanned.toLocaleString(),
              total: scan.rowCount.toLocaleString(),
            })}
            {" · "}
            {$t("parquet.profileDistinct", { count: scan.distinct.toLocaleString() })}
          </p>
        </>
      ) : loading ? (
        <p className="parquet-viewer__profile-note">{$t("parquet.profileScanning")}</p>
      ) : (
        <button type="button" className="parquet-viewer__pager-btn" onClick={onScan}>
          {$t("parquet.profileScan")}
        </button>
      )}
    </section>
  );
}
