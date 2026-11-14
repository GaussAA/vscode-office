import { useEffect, useRef } from "react";

/**
 * Hook to ensure cleanup of timers on unmount.
 *
 * Returns a function that creates auto-cleanup timers.
 *
 * @example
 * ```typescript
 * const useTimer = useAutoCleanupTimer();
 *
 * useEffect(() => {
 *   const timer = useTimer.setTimeout(() => {
 *     console.log("This will be cleaned up on unmount");
 *   }, 1000);
 * }, []);
 * ```
 */
export function useAutoCleanupTimer() {
  const timersRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      // Cleanup all timers on unmount
      timers.forEach((id) => {
        window.clearTimeout(id);
      });
      timers.clear();
    };
  }, []);

  return {
    setTimeout: (callback: () => void, delay: number): number => {
      const id = window.setTimeout(() => {
        timersRef.current.delete(id);
        callback();
      }, delay);
      timersRef.current.add(id);
      return id;
    },
    setInterval: (callback: () => void, delay: number): number => {
      const id = window.setInterval(callback, delay);
      timersRef.current.add(id);
      return id;
    },
    clear: (id: number): void => {
      window.clearTimeout(id);
      timersRef.current.delete(id);
    },
  };
}

/**
 * Hook to ensure cleanup of event listeners on unmount.
 *
 * @example
 * ```typescript
 * const addEventListener = useAutoCleanupEventListener();
 *
 * useEffect(() => {
 *   addEventListener(window, 'resize', handleResize);
 *   addEventListener(document, 'keydown', handleKeyDown);
 * }, []);
 * ```
 */
export function useAutoCleanupEventListener() {
  const listenersRef = useRef<
    Array<{
      target: EventTarget;
      type: string;
      listener: EventListener;
      options?: boolean | AddEventListenerOptions;
    }>
  >([]);

  useEffect(() => {
    const listeners = listenersRef.current;
    return () => {
      // Cleanup all event listeners on unmount
      listeners.forEach(({ target, type, listener, options }) => {
        target.removeEventListener(type, listener, options);
      });
      listenersRef.current = [];
    };
  }, []);

  return (
    target: EventTarget,
    type: string,
    listener: EventListener,
    options?: boolean | AddEventListenerOptions,
  ): void => {
    target.addEventListener(type, listener, options);
    listenersRef.current.push({ target, type, listener, options });
  };
}

/**
 * Hook to track and log memory usage in development.
 *
 * @example
 * ```typescript
 * useMemoryMonitor('MyComponent');
 * ```
 */
export function useMemoryMonitor(componentName: string) {
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;

    const memory = (performance as any).memory;
    if (!memory) return;

    const initialMemory = memory.usedJSHeapSize;

    console.log(
      `[${componentName}] Mounted - Memory: ${(initialMemory / 1024 / 1024).toFixed(2)} MB`,
    );

    return () => {
      const finalMemory = memory.usedJSHeapSize;
      const delta = finalMemory - initialMemory;
      const sign = delta >= 0 ? "+" : "";

      console.log(
        `[${componentName}] Unmounted - Memory delta: ${sign}${(delta / 1024 / 1024).toFixed(2)} MB`,
      );
    };
  }, [componentName]);
}
