// ExcelJS-dependent style functions disabled (switched to SheetJS read-only mode)

export interface CellStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  fontSize?: number;
  fontName?: string;
  color?: string;
  bgcolor?: string;
  align?: "left" | "center" | "right";
  valign?: "top" | "middle" | "bottom";
  textwrap?: boolean;
  border?: {
    top?: string[];
    right?: string[];
    bottom?: string[];
    left?: string[];
  };
}

export class StyleRegistry {
  private styles: CellStyle[] = [];
  private map = new Map<string, number>();

  register(style: CellStyle): number {
    const key = JSON.stringify(style);
    const existing = this.map.get(key);
    if (existing != null) return existing;
    const index = this.styles.length;
    this.styles.push(style);
    this.map.set(key, index);
    return index;
  }

  getAllStyles(): CellStyle[] {
    return this.styles;
  }
}
