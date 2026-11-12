import { t } from "./excel_i18n";

interface WindowedSheetBannerProps {
  fileName: string;
  rowCount: number;
  columnCount: number;
  sheetNames?: string[];
  activeSheet?: number;
  onSelectSheet?: (index: number) => void;
  onOpenInVSCode: () => void;
}

export default function WindowedSheetBanner({
  fileName,
  rowCount,
  columnCount,
  sheetNames,
  activeSheet,
  onSelectSheet,
  onOpenInVSCode,
}: WindowedSheetBannerProps) {
  return (
    <div className="windowed-sheet__banner">
      <div className="windowed-sheet__identity">
        <span className="windowed-sheet__mode">{t("viewer.windowedMode")}</span>
        <span className="windowed-sheet__hint">{t("viewer.windowedHint")}</span>
        <span className="windowed-sheet__file">{fileName}</span>
        <span className="windowed-sheet__meta">
          {rowCount.toLocaleString()} × {columnCount.toLocaleString()}
        </span>
        {sheetNames && sheetNames.length > 1 && (
          <label className="windowed-sheet__sheet">
            <span>{t("viewer.sheet")}</span>
            <select
              className="windowed-sheet__select"
              value={activeSheet ?? 0}
              onChange={(event) => onSelectSheet?.(Number(event.target.value))}
            >
              {sheetNames.map((name, index) => (
                <option key={`${name}-${index}`} value={index}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <button type="button" className="windowed-sheet__link" onClick={onOpenInVSCode}>
        {t("viewer.tooLargeOpenInVSCode")}
      </button>
    </div>
  );
}
