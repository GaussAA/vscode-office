/**
 * Screen Reader Announcements for Parquet Viewer
 *
 * Manages live region announcements for accessibility.
 * Uses ARIA live regions to notify screen reader users of:
 * - Page navigation changes
 * - Search result counts
 *
 * @module useParquetAnnouncements
 */

import { useCallback, useState } from "react";
import { $t } from "../../i18n/i18nConfig.ts";
import { formatRowRange } from "./parquetAnnounce.ts";

/**
 * Manages live region announcements for screen readers.
 *
 * Announces:
 * - Page navigation: "Rows 1-100 of 1,000"
 * - Search results: "5 matches found"
 *
 * @param totalRows - Function that returns the total row count
 * @returns Announcement state and control functions
 */
export function useParquetAnnouncements(totalRows: () => number) {
  const [announcement, setAnnouncement] = useState("");

  /**
   * Announce page navigation to screen readers.
   *
   * @param start - Zero-based index of first row on page
   * @param loaded - Number of rows loaded on this page
   * @example
   * ```ts
   * announcePage(0, 100); // "Rows 1-100 of 1,000"
   * ```
   */
  const announcePage = useCallback(
    (start: number, loaded: number) => {
      const total = totalRows();
      setAnnouncement(formatRowRange(start, loaded, total));
    },
    [totalRows],
  );

  /**
   * Announce search results to screen readers.
   *
   * @param matches - Number of matching rows found
   * @example
   * ```ts
   * announceSearch(5); // "5 matches found"
   * announceSearch(1); // "1 match found"
   * ```
   */
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
