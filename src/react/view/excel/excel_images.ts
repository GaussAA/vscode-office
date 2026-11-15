// ExcelJS-dependent image functions disabled (switched to SheetJS read-only mode)
// Only keeping the display helper that's still used

export interface SheetImage {
  extension: string;
  base64: string;
  range: string;
}

export function sheetImageDataUrl(image: Pick<SheetImage, "extension" | "base64">): string {
  return `data:image/${image.extension};base64,${image.base64}`;
}
