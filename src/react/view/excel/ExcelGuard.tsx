import { useCallback, useEffect, useRef, useState } from "react";
import { formatBytes } from "@/common/previewLimit";
import { t } from "./excel_i18n";

export interface ExcelTooLarge {
  size: number;
  name: string;
  ext: string;
  /** The limit this file missed; local text and virtual text have different ones. */
  limit: number;
}

interface ExcelGuardProps {
  file: ExcelTooLarge;
  onOpenAnyway: () => void;
  onOpenInVSCode: () => void;
}

/**
 * The refusal panel for an oversized file. It owns the two-step retry: the safe editor exit is
 * focused first, and loading the full grid needs a second, explicitly named confirmation.
 */
export default function ExcelGuard({ file, onOpenAnyway, onOpenInVSCode }: ExcelGuardProps) {
  const [armed, setArmed] = useState(false);
  const safeActionRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => safeActionRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!armed) return;
    const frame = requestAnimationFrame(() => cancelRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [armed]);

  const cancel = useCallback(() => {
    setArmed(false);
    requestAnimationFrame(() => safeActionRef.current?.focus());
  }, []);

  return (
    <div
      className="excel-too-large"
      role="dialog"
      aria-modal="true"
      aria-labelledby="excel-too-large-title"
      aria-describedby="excel-too-large-body"
      onKeyDown={(event) => {
        if (event.key === "Escape" && armed) {
          event.stopPropagation();
          cancel();
        }
      }}
    >
      <div className="excel-too-large-panel">
        <svg
          className="excel-too-large-icon"
          width="28"
          height="28"
          viewBox="0 0 28 28"
          fill="none"
          aria-hidden
        >
          <path
            d="M7 3.5h9l5 5v16H7z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <path d="M16 3.5v5h5" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M14 12v5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <circle cx="14" cy="21" r="1" fill="currentColor" />
        </svg>
        <h2 className="excel-too-large-title" id="excel-too-large-title">
          {t("viewer.tooLargeTitle")}
        </h2>
        <p className="excel-too-large-body" id="excel-too-large-body">
          {t("viewer.tooLargeBody", file.name, formatBytes(file.size), formatBytes(file.limit))}
        </p>
        {armed && <p className="excel-too-large-confirm">{t("viewer.tooLargeConfirm")}</p>}
        <div className="excel-too-large-actions">
          <button
            ref={safeActionRef}
            type="button"
            className="excel-too-large-action excel-too-large-action--primary"
            onClick={onOpenInVSCode}
          >
            {t("viewer.tooLargeOpenInVSCode")}
          </button>
          {!armed ? (
            <button
              type="button"
              className="excel-too-large-action excel-too-large-action--secondary"
              onClick={() => setArmed(true)}
            >
              {t("viewer.tooLargeOpen")}
            </button>
          ) : (
            <button
              type="button"
              className="excel-too-large-action excel-too-large-action--danger"
              onClick={onOpenAnyway}
            >
              {t("viewer.tooLargeConfirmOpen")}
            </button>
          )}
          {armed && (
            <button
              ref={cancelRef}
              type="button"
              className="excel-too-large-action excel-too-large-action--ghost"
              onClick={cancel}
            >
              {t("button.cancel")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
