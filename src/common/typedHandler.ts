import type { HostToWebviewMessage, WebviewToHostMessage, EventOf, PayloadOf } from "./messages";
import type { SimpleEventEmitter } from "./simpleEventEmitter";
import type * as vscode from "vscode";

/**
 * Typed wrapper for host-side message handling.
 * Provides type-safe emit (Host→Webview) and on (Webview→Host).
 */
export class TypedHandler {
  constructor(
    private readonly webview: vscode.Webview,
    private readonly emitter: SimpleEventEmitter,
  ) {}

  /**
   * Send a typed message from host to webview.
   */
  emit<TEvent extends EventOf<HostToWebviewMessage>>(
    event: TEvent,
    ...args: PayloadOf<HostToWebviewMessage, TEvent> extends void
      ? []
      : [PayloadOf<HostToWebviewMessage, TEvent>]
  ): void {
    if (args.length === 0) {
      this.webview.postMessage({ event });
    } else {
      this.webview.postMessage({ event, data: args[0] });
    }
  }

  /**
   * Register a typed listener for webview→host messages.
   */
  on<TEvent extends EventOf<WebviewToHostMessage>>(
    event: TEvent,
    listener: PayloadOf<WebviewToHostMessage, TEvent> extends void
      ? () => void
      : (payload: PayloadOf<WebviewToHostMessage, TEvent>) => void,
  ): this {
    this.emitter.on(event, listener as (...args: unknown[]) => void);
    return this;
  }

  /**
   * Access the underlying emitter for other events (e.g., fileChange, dispose).
   */
  get raw(): SimpleEventEmitter {
    return this.emitter;
  }
}
