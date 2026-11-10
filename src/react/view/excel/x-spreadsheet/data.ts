export type CellMerge = [number, number];

export interface ColProperties {
  width?: number;
}

export interface CellData {
  text: string;
  /** Imported numeric format and its corresponding viewer format. */
  numFmt?: string;
  numFmtFormat?: string;
  style?: number;
  merge?: CellMerge;
  /** false 表示不可编辑（对应 Excel 锁定单元格） */
  editable?: boolean;
}

export interface RowData {
  cells: {
    [key: number]: CellData;
  };
  height?: number;
}

export interface RowsData {
  len?: number;
  [key: number]: RowData | number | undefined;
}

export interface SheetAutofilterData {
  ref: string;
  filters?: { ci: number; operator: string; value: unknown }[];
  sort?: { ci: number; order: string };
}

export interface SheetHyperlinkData {
  link: string;
  tooltip?: string;
}

export interface SheetValidationData {
  refs: string[];
  mode: string;
  type: string;
  required?: boolean;
  operator?: string;
  value?: string | string[] | number;
}

export interface SheetImageAnchor {
  col: number;
  row: number;
  width?: number;
  height?: number;
  brCol?: number;
  brRow?: number;
  editAs?: string;
}

export interface SheetImage {
  id: string;
  imageId: number;
  extension: "jpeg" | "png" | "gif";
  base64: string;
  anchor: SheetImageAnchor;
}

export interface SheetBackgroundImage {
  imageId: number;
  extension: "jpeg" | "png" | "gif";
  base64: string;
}

export interface SheetData {
  name?: string;
  freeze?: string;
  autofilter?: SheetAutofilterData;
  hyperlinks?: Record<string, SheetHyperlinkData>;
  validations?: SheetValidationData[];
  /** Excel 工作表保护配置（不含密码） */
  sheetProtection?: Record<string, unknown>;
  images?: SheetImage[];
  backgroundImage?: SheetBackgroundImage;
  styles?: CellStyle[];
  merges?: string[];
  cols?: {
    len?: number;
    [key: number]: ColProperties | number | undefined;
  };
  rows?: RowsData;
}

export interface SpreadsheetData {
  name?: string;
  [index: number]: SheetData;
}

export interface CellStyle {
  align?: "left" | "center" | "right";
  valign?: "top" | "middle" | "bottom";
  font?: {
    name?: string;
    size?: number;
    bold?: boolean;
    italic?: boolean;
  };
  bgcolor?: string;
  textwrap?: boolean;
  strike?: boolean;
  underline?: boolean;
  color?: string;
  border?: {
    top?: string[];
    right?: string[];
    bottom?: string[];
    left?: string[];
  };
  format?: string;
}
