import { useCallback, useEffect, useRef, useState } from "react";
import { SIDER_DEFAULT, SIDER_MAX, SIDER_MIN, SIDER_STORAGE_KEY } from "./parquetLayout";

export function parseStoredSiderWidth(raw: string | null): number {
  const saved = Number(raw);
  if (Number.isFinite(saved) && saved >= SIDER_MIN && saved <= SIDER_MAX) return saved;
  return SIDER_DEFAULT;
}

type SetWidth = (next: number | ((current: number) => number)) => void;

const clampSiderWidth = (value: number) =>
  Math.min(SIDER_MAX, Math.max(SIDER_MIN, Math.round(value)));

/**
 * Sidebar width: persistence, drag with pointer capture, and the body cursor that makes the
 * resize discoverable. Cleanup lives here so an interrupted drag cannot leave the whole app in
 * `col-resize` with text selection disabled.
 */
export function useParquetSiderResize() {
  const [width, setWidthState] = useState(() => {
    try {
      return parseStoredSiderWidth(localStorage.getItem(SIDER_STORAGE_KEY));
    } catch {
      return SIDER_DEFAULT;
    }
  });
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const setWidth = useCallback<SetWidth>((next) => {
    setWidthState((current) => clampSiderWidth(typeof next === "function" ? next(current) : next));
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(SIDER_STORAGE_KEY, String(width));
    } catch {}
  }, [width]);

  const restoreBody = useCallback(() => {
    document.body.style.removeProperty("cursor");
    document.body.style.removeProperty("user-select");
  }, []);

  useEffect(() => restoreBody, [restoreBody]);

  const beginResize = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      dragRef.current = { startX: event.clientX, startWidth: width };
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {}
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [width],
  );

  const moveResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    setWidthState(clampSiderWidth(drag.startWidth + event.clientX - drag.startX));
  }, []);

  const endResize = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      dragRef.current = null;
      try {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      } catch {}
      restoreBody();
    },
    [restoreBody],
  );

  return { siderWidth: width, setSiderWidth: setWidth, beginResize, moveResize, endResize };
}
