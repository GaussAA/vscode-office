import { t } from "./excel_i18n";

interface ExcelLoadErrorProps {
  message: string;
}

export default function ExcelLoadError({ message }: ExcelLoadErrorProps) {
  return (
    <div className="excel-load-error">
      <div className="excel-load-error-panel">
        <svg
          className="excel-load-error-icon"
          width="44"
          height="44"
          viewBox="0 0 44 44"
          fill="none"
          aria-hidden
        >
          <circle cx="22" cy="22" r="20" stroke="currentColor" strokeWidth="1.8" />
          <path d="M22 13v12" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          <circle cx="22" cy="31" r="1.8" fill="currentColor" />
        </svg>
        <h2 className="excel-load-error-title">{t("viewer.loadErrorTitle")}</h2>
        <span className="excel-load-error-message">{message}</span>
      </div>
    </div>
  );
}
