/**
 * React Hook for automatic event listener cleanup.
 *
 * Usage:
 * ```tsx
 * useEventListener(window, 'resize', handleResize);
 * useEventListener(ref.current, 'click', handleClick);
 * ```
 */
import { useEffect, useRef } from "react";

type EventTarget = Window | Document | HTMLElement | null;

export function useEventListener<K extends keyof WindowEventMap>(
  target: Window,
  eventName: K,
  handler: (event: WindowEventMap[K]) => void,
  options?: boolean | AddEventListenerOptions,
): void;

export function useEventListener<K extends keyof DocumentEventMap>(
  target: Document,
  eventName: K,
  handler: (event: DocumentEventMap[K]) => void,
  options?: boolean | AddEventListenerOptions,
): void;

export function useEventListener<K extends keyof HTMLElementEventMap>(
  target: HTMLElement | null,
  eventName: K,
  handler: (event: HTMLElementEventMap[K]) => void,
  options?: boolean | AddEventListenerOptions,
): void;

export function useEventListener(
  target: EventTarget,
  eventName: string,
  handler: (event: Event) => void,
  options?: boolean | AddEventListenerOptions,
): void {
  const savedHandler = useRef(handler);

  // Update saved handler if it changes
  useEffect(() => {
    savedHandler.current = handler;
  }, [handler]);

  useEffect(() => {
    if (!target) return;

    const eventListener = (event: Event) => savedHandler.current(event);

    target.addEventListener(eventName, eventListener, options);

    // Cleanup function - automatically called when component unmounts
    return () => {
      target.removeEventListener(eventName, eventListener, options);
    };
  }, [target, eventName, options]);
}

/**
 * Hook for custom event emitter cleanup (handler.on/off pattern).
 *
 * Usage:
 * ```tsx
 * useHandlerEvent(handler, 'data', (payload) => {
 *   console.log(payload);
 * });
 * ```
 */
export function useHandlerEvent<TPayload = any>(
  handler: {
    on: (event: string, callback: (payload: TPayload) => void) => any;
    off?: (event: string, callback: (payload: TPayload) => void) => boolean;
  },
  eventName: string,
  callback: (payload: TPayload) => void,
): void {
  const savedCallback = useRef(callback);

  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    const wrappedCallback = (payload: TPayload) => savedCallback.current(payload);

    handler.on(eventName, wrappedCallback);

    // Cleanup: use off() method if available
    return () => {
      if (handler.off) {
        handler.off(eventName, wrappedCallback);
      }
    };
  }, [handler, eventName]);
}
