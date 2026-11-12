import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from "react";
import { t } from "./excel_i18n";

interface WindowedFindBarProps {
  findInputRef?: RefObject<HTMLInputElement | null>;
  query: string;
  countLabel: string;
  matches: number;
  isSearchResult: boolean;
  jumpValue: string;
  onQueryChange: (value: string) => void;
  onFind: () => void;
  onFindKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
  onPrevious: () => void;
  onNext: () => void;
  onJumpValueChange: (value: string) => void;
  onJump: () => void;
}

export default function WindowedFindBar({
  findInputRef,
  query,
  countLabel,
  matches,
  isSearchResult,
  jumpValue,
  onQueryChange,
  onFind,
  onFindKeyDown,
  onPrevious,
  onNext,
  onJumpValueChange,
  onJump,
}: WindowedFindBarProps) {
  return (
    <div className="windowed-sheet__tools">
      <div className="windowed-sheet__find">
        <input
          ref={findInputRef}
          className="windowed-sheet__input"
          value={query}
          placeholder={t("findReplace.placeholder")}
          aria-label={t("findReplace.title")}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={onFindKeyDown}
        />
        <button type="button" className="windowed-sheet__btn" onClick={onFind}>
          {t("findReplace.title")}
        </button>
        <button
          type="button"
          className="windowed-sheet__btn windowed-sheet__btn--icon"
          aria-label={t("findReplace.previous")}
          disabled={!isSearchResult || matches === 0}
          onClick={onPrevious}
        >
          ↑
        </button>
        <button
          type="button"
          className="windowed-sheet__btn windowed-sheet__btn--icon"
          aria-label={t("findReplace.next")}
          disabled={!isSearchResult || matches === 0}
          onClick={onNext}
        >
          ↓
        </button>
        <span className="windowed-sheet__count" role="status" aria-live="polite">
          {countLabel}
        </span>
      </div>
      <span className="windowed-sheet__spacer" />
      <div className="windowed-sheet__jump">
        <input
          className="windowed-sheet__input windowed-sheet__input--row"
          value={jumpValue}
          placeholder={t("viewer.goToRow")}
          aria-label={t("viewer.goToRow")}
          onChange={(event) => onJumpValueChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onJump();
          }}
        />
        <button type="button" className="windowed-sheet__btn" onClick={onJump}>
          {t("viewer.go")}
        </button>
      </div>
    </div>
  );
}
