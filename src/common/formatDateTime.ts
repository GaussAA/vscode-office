/**
 * `yyyy-MM-dd hh:mm:ss` in local time, for archive listings.
 *
 * This used to be `date-format@4.0.14` — a 50-month-stale 60-star package — for one format
 * string used at exactly two call sites. `Intl` cannot reproduce this shape without
 * `formatToParts` gymnastics and locale-dependent separators, and the listing wants a
 * *fixed*, sortable, locale-independent string, so it is spelled out here instead.
 */
const pad = (value: number): string => String(value).padStart(2, '0');

export function formatDateTime(date: Date): string {
    return (
        `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
        ` ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
    );
}
