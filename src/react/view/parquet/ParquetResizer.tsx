import { $t } from "../../i18n/i18nConfig.ts";

interface ParquetResizerProps {
  siderWidth: number;
  siderMin: number;
  siderMax: number;
  siderDefault: number;
  onSiderWidthChange: (width: number | ((prev: number) => number)) => void;
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (event: React.PointerEvent<HTMLDivElement>) => void;
  onLostPointerCapture: (event: React.PointerEvent<HTMLDivElement>) => void;
}

/**
 * Resizable divider between schema sidebar and table content.
 * Supports mouse drag, keyboard navigation, and double-click to reset.
 */
export default function ParquetResizer({
  siderWidth,
  siderMin,
  siderMax,
  siderDefault,
  onSiderWidthChange,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onLostPointerCapture,
}: ParquetResizerProps) {
  return (
    <div
      className="parquet-viewer__resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label={$t("parquet.resizeSidebar")}
      aria-valuemin={siderMin}
      aria-valuemax={siderMax}
      aria-valuenow={siderWidth}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onLostPointerCapture}
      onDoubleClick={() => onSiderWidthChange(siderDefault)}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          const delta = event.key === "ArrowRight" ? 16 : -16;
          onSiderWidthChange((width) => width + delta);
        } else if (event.key === "Home") {
          event.preventDefault();
          onSiderWidthChange(siderMin);
        } else if (event.key === "End") {
          event.preventDefault();
          onSiderWidthChange(siderMax);
        }
      }}
    />
  );
}
