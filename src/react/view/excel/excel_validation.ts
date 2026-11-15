// ExcelJS-dependent validation functions disabled (switched to SheetJS read-only mode)

export interface SpreadsheetValidationItem {
  refs: string[];
  mode: string;
  type: string;
  required?: boolean;
  operator?: string;
  value?: string | string[] | number;
}
