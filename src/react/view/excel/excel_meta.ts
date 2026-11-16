import type { CellStyle, SheetData } from "./x-spreadsheet/index";

/** x-spreadsheet 默认行高（px），与 Excel.tsx 中 row.height 一致 */
const DEFAULT_ROW_HEIGHT_PX = 30;

/** 视口最少列数（A–X，共 24 列） */
export const MIN_VIEW_COLS = 24;

/** 视口最少行数 */
export const MIN_VIEW_ROWS = 40;

interface SpreadsheetAutofilter {
  ref: string;
  filters?: { ci: number; operator: string; value: unknown }[];
  sort?: { ci: number; order: string };
}

interface FormattingSheetSnapshot {
  styles?: CellStyle[];
  merges?: string[];
  freeze?: string;
  autofilter?: SpreadsheetAutofilter;
  cellStyles: [number, number, number][];
  rowHeights: [number, number][];
}

function buildSheetFormattingSnapshot(sheet: SheetData): FormattingSheetSnapshot {
  const cellStyles: [number, number, number][] = [];
  const rowHeights: [number, number][] = [];
  const rows = sheet.rows;
  if (rows?.len) {
    for (let ri = 0; ri < rows.len; ri += 1) {
      const row = rows[ri];
      if (!row || typeof row !== "object") continue;
      if (
        "height" in row &&
        row.height != null &&
        Math.abs(row.height - DEFAULT_ROW_HEIGHT_PX) >= 1
      ) {
        rowHeights.push([ri, row.height]);
      }
      if (!("cells" in row) || !row.cells) continue;
      for (const ciKey of Object.keys(row.cells)) {
        const ci = Number(ciKey);
        const cell = row.cells[ci];
        if (cell?.style != null) {
          cellStyles.push([ri, ci, cell.style]);
        }
      }
    }
  }
  cellStyles.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  rowHeights.sort((a, b) => a[0] - b[0]);

  const af = sheet.autofilter as SpreadsheetAutofilter | undefined;
  return {
    styles: sheet.styles,
    merges: sheet.merges?.length ? [...sheet.merges].sort() : undefined,
    freeze: sheet.freeze,
    autofilter: af?.ref ? af : undefined,
    cellStyles,
    rowHeights,
  };
}

/** 提取与工具栏相关的格式快照，用于对比是否发生过样式变更 */
export function buildFormattingSnapshot(sheets: SheetData[]): string {
  return JSON.stringify(sheets.map(buildSheetFormattingSnapshot));
}

/** 相对初始快照是否发生过格式变更 */
export function hasFormattingChanged(initialSnapshot: string, sheets: SheetData[]): boolean {
  if (!initialSnapshot) return false;
  return buildFormattingSnapshot(sheets) !== initialSnapshot;
}
