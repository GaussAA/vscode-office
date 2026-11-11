/**
 * The detail pane's keymap, as a pure decision.
 *
 * Precedence matters and has been wrong before: rc-tree already handles Enter/Space/Arrow on
 * its focused rows, the value toggle is a real button, and Ctrl+C must still work while that
 * button is focused — but not while the user is selecting text in an input or the panel. The
 * component translates the event into flags and executes the returned action; this module
 * owns the order, and the table is testable without a DOM.
 */
export type DetailKeyAction =
  | { type: "close-panel" }
  | { type: "copy"; target: "value" | "path" }
  | { type: "toggle-panel" }
  | { type: "expand" }
  | { type: "collapse" }
  | { type: "toggle-expand" }
  | { type: "ignore" };

export interface DetailKeyInput {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  /** rc-tree already consumed the key. */
  defaultPrevented: boolean;
  /** The event target is a button, input, textarea, radio or the panel's scroll area. */
  onControl: boolean;
  /** The event target is an input, textarea or the panel's scroll area (native copy). */
  nativeText: boolean;
  hasSelection: boolean;
  panelOpen: boolean;
  hasActiveKey: boolean;
}

export function detailKeyAction(input: DetailKeyInput): DetailKeyAction {
  // Escape closes the panel from anywhere, including its own scroll area.
  if (input.key === "Escape" && input.panelOpen) return { type: "close-panel" };
  // rc-tree handles Arrow/Enter/Space on its focused rows and calls preventDefault.
  if (input.defaultPrevented) return { type: "ignore" };
  // Copy works from the toggle too, but not while the browser has a native text selection.
  if ((input.ctrlKey || input.metaKey) && input.key.toLowerCase() === "c" && !input.nativeText) {
    return { type: "copy", target: input.shiftKey ? "path" : "value" };
  }
  if (input.onControl) return { type: "ignore" };
  if (input.hasSelection && input.key === "Enter") return { type: "toggle-panel" };
  if (input.hasActiveKey) {
    if (input.key === "ArrowRight") return { type: "expand" };
    if (input.key === "ArrowLeft") return { type: "collapse" };
    if (input.key === " " || input.key === "Spacebar") return { type: "toggle-expand" };
  }
  return { type: "ignore" };
}
