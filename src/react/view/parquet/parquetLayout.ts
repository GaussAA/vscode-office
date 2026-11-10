/**
 * Fixed numbers the parquet viewer is built from — layout, bounds, storage keys.
 *
 * They live here rather than inside `Parquet.tsx` because several of them are shared contracts:
 * the stylesheet must agree with `ROW_HEIGHT`, the schema jump must agree with
 * `INDEX_COLUMN_WIDTH`/`DATA_COLUMN_WIDTH`, and the persisted keys must not drift between the
 * reader and the writer.
 */

/** A page below this is not a screenful; above it, paging stops being useful. */
export const MIN_ROWS_PER_PAGE = 8;
export const PARQUET_MAX_PAGE_SIZE = 200;
/** Cap on matched rows kept in memory (highlight + navigation). */
export const SEARCH_MAX_ROWS = 5_000;
/** Schema sidebar bounds; the drag handle and keyboard use the same range. */
export const SIDER_MIN = 208;
export const SIDER_MAX = 420;
export const SIDER_DEFAULT = 260;
export const SIDER_STORAGE_KEY = "parquet-sider-width";
/** Must agree with the column widths passed to <Table>: the sidebar jump uses arithmetic. */
export const INDEX_COLUMN_WIDTH = 64;
export const DATA_COLUMN_WIDTH = 120;
/** Column width bounds, in px. Below 64 the header text is unreadable; above 480 a wide table
 *  stops fitting anything. */
export const COLUMN_MIN_WIDTH = 64;
export const COLUMN_MAX_WIDTH = 480;
export const COLUMN_WIDTH_STORAGE_KEY = "parquet-column-widths";
/**
 * How wide a column may grow to help fill the viewport before the grid simply stops short.
 *
 * Without a cap antd stretches the columns proportionally, which turned a four-column file into
 * four 273px panels and made a dragged width land somewhere other than where it was dropped.
 * "Density is efficiency" (DESIGN.md) is the reason to stop: a 550px-wide `id` column is not
 * more readable, it is just wider.
 */
export const COLUMN_STRETCH_MAX = 240;
/** How long a selection must hold still before it is announced to assistive tech. */
export const ANNOUNCE_DELAY_MS = 600;
/** Must agree with `.parquet-viewer__cell` in the stylesheet: 6px padding ×2 + 22px line-height. */
export const ROW_HEIGHT = 34;
