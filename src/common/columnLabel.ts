/**
 * Excel column labels and their indexes.
 *
 * Spreadsheet columns run A..Z, AA..ZZ, AAA.., with the last column XFD (index 16383).
 * The mapping is a base-26 numeral system where A=0, not base conversion with A=1: AA is
 * column 26, not 27. The three implementations of this existed (excel_meta, windowedSheetModel,
 * alphabet.js) and two were wrong for columns >= 702 (BAA instead of ABA), so here is the
 * single source of truth.
 */

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/**
 * Column index to label: 0 → A, 25 → Z, 26 → AA, 16383 → XFD.
 *
 * This is the correct implementation (matches SheetJS `XLSX.utils.encode_col` over every
 * column up to XFD). The two implementations it replaces divided by 26 without flooring,
 * which produced BAA for index 728 instead of ABA.
 */
export function columnLabel(index: number): string {
  let label = "";
  let remaining = index;
  do {
    label = LETTERS.charAt(remaining % 26) + label;
    remaining = Math.floor(remaining / 26) - 1;
  } while (remaining >= 0);
  return label;
}

/**
 * Column label to index: A → 0, Z → 25, AA → 26, XFD → 16383.
 *
 * Uppercase letters only; lowercase is uppercased first. An empty string is -1 (the subtract-1
 * at the end turns the 1-based intermediate into 0-based output). This matches the existing
 * `indexAt` and `freezeExprToExcelView` behavior.
 */
export function columnIndex(label: string): number {
  const upper = label.toUpperCase();
  let index = 0;
  for (let i = 0; i < upper.length; i++) {
    index = 26 * index + upper.charCodeAt(i) - 64;
  }
  return index - 1;
}
