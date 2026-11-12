import { t } from "./excel_i18n";

interface WindowedSelectionBarProps {
  path: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
}

export default function WindowedSelectionBar({
  path,
  value,
  copied,
  onCopy,
}: WindowedSelectionBarProps) {
  return (
    <div className="windowed-sheet__selection">
      <span className="windowed-sheet__path">{path}</span>
      <span className="windowed-sheet__value">{value}</span>
      <button
        type="button"
        className="windowed-sheet__copy"
        onClick={onCopy}
        aria-label={t("button.copy")}
      >
        {copied ? t("viewer.copied") : t("button.copy")}
      </button>
    </div>
  );
}
