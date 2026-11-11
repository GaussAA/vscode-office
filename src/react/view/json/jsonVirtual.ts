import { useEffect, useRef, useState } from "react";

export const JSON_ROW_HEIGHT = 28;

/**
 * Fixed-height virtual window for the record/search rails. The 100 MB array can hold more
 * records than the DOM should ever see; only the rows around the viewport are rendered, and
 * the caller gets `start/end` so it can request labels for exactly that window.
 */
export function useVirtualWindow(count: number) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setHeight(element.clientHeight));
    observer.observe(element);
    setHeight(element.clientHeight);
    return () => observer.disconnect();
  }, []);

  const onScroll = (event: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(event.currentTarget.scrollTop);
  };

  const start = Math.max(0, Math.floor(scrollTop / JSON_ROW_HEIGHT) - 2);
  const end = Math.min(count, Math.ceil((scrollTop + height) / JSON_ROW_HEIGHT) + 2);
  return {
    ref,
    onScroll,
    start,
    end,
    height,
    scrollTop,
    totalHeight: count * JSON_ROW_HEIGHT,
  };
}
