import { useCallback, useState } from "react";
import { $t } from "../../i18n/i18nConfig.ts";
import { formatRowRange } from "./parquetAnnounce.ts";

/**
 * Manages live region announcements for screen readers.
 *
 * Announces:
 * - Page navigation: "Rows 1-100 of 1,000"
 * - Search results: "5 matches found"
 */
export function useParquetAnnouncements(totalRows: () => number) {
  const [announcement, setAnnouncement] = useState("");

  const announcePage = useCallback(
    (start: number, loaded: number) => {
      const total = totalRows();
      setAnnouncement(formatRowRange(start, loaded, total));
    },
    [totalRows],
  );

  const announceSearch = useCallback((matches: number) => {
    setAnnouncement(
      matches === 1
        ? $t("parquet.matchCountOne", { count: 1 })
        : $t("parquet.matchCountMany", { count: matches }),
    );
  }, []);

  const clearAnnouncement = useCallback(() => {
    setAnnouncement("");
  }, []);

  return {
    announcement,
    announcePage,
    announceSearch,
    clearAnnouncement,
  };
}
