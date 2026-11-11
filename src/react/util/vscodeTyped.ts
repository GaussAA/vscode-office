/**
 * Typed wrapper for webview-side message handling.
 * Provides type-safe emit (Webview→Host) and on (Host→Webview).
 */

import type {
  HostToWebviewMessage,
  WebviewToHostMessage,
  EventOf,
  PayloadOf,
} from "../../common/messages";

declare const acquireVsCodeApi: () => {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = (window as any)["acquireVsCodeApi"]?.() as
  | ReturnType<typeof acquireVsCodeApi>
  | undefined;

export { vscode as vscodeApi };

/**
 * Send a typed message from webview to host.
 */
export function emitTyped<TEvent extends EventOf<WebviewToHostMessage>>(
  event: TEvent,
  ...args: PayloadOf<WebviewToHostMessage, TEvent> extends void
    ? []
    : [PayloadOf<WebviewToHostMessage, TEvent>]
): void {
  if (!vscode) return;
  if (args.length === 0) {
    vscode.postMessage({ event });
  } else {
    vscode.postMessage({ event, data: args[0] });
  }
}

/**
 * Register a typed listener for host→webview messages.
 */
export function onTyped<TEvent extends EventOf<HostToWebviewMessage>>(
  event: TEvent,
  listener: PayloadOf<HostToWebviewMessage, TEvent> extends void
    ? () => void
    : (payload: PayloadOf<HostToWebviewMessage, TEvent>) => void,
): void {
  const existingHandler = (window as any)["__vscodeTypedHandlers"];
  if (!existingHandler) {
    (window as any)["__vscodeTypedHandlers"] = {};
  }
  (window as any)["__vscodeTypedHandlers"][event] = listener;
}

// Wire up the existing untyped handler to dispatch to typed handlers
if (typeof window !== "undefined") {
  window.addEventListener("message", (e) => {
    const message = e.data;
    if (message && typeof message.event === "string") {
      const handlers = (window as any)["__vscodeTypedHandlers"] || {};
      const handler = handlers[message.event];
      if (handler) {
        handler(message.data);
      }
      // Also dispatch to legacy untyped handlers
      const legacyEvents = (window as any)["__vscodeEvents"] || {};
      const legacyHandler = legacyEvents[message.event];
      if (legacyHandler) {
        legacyHandler(message.data);
      }
    }
  });
}
