const vscode = (window as any)["acquireVsCodeApi"]?.();
export { vscode as vscodeApi };
const postMessage = (message: unknown) => {
  if (vscode) {
    vscode.postMessage(message);
  }
};

const events: Record<string, (content: any) => void> = {};
function receive({ data }: MessageEvent) {
  if (!data) return;
  if (events[data.type]) {
    events[data.type](data.content);
  }
}

const isMac = navigator.userAgent.includes("Mac OS");

// Keyboard handler for Mac compose key prevention
function preventMacComposeConflict(e: KeyboardEvent) {
  if (isMac && isCompose(e) && (e.altKey || e.code == "KeyW")) {
    e.preventDefault();
  }
}

// Keyboard handler for F12 developer tools and Hebrew paste bug
function handleGlobalKeyboard(e: KeyboardEvent) {
  if (e.code == "F12") handler.emit("developerTool");
  else if (isCompose(e) && e.code == "KeyV") e.preventDefault(); // vscode的bug, hebrew(希伯来语)键盘会粘贴两次
}

// Install global event listeners (called once at module load)
window.addEventListener("message", receive);
window.addEventListener("keydown", preventMacComposeConflict, isMac ? true : undefined);
window.addEventListener("keydown", handleGlobalKeyboard);

const getVscodeEvent = () => {
  return {
    on(event: string, data: (content: any) => void) {
      events[event] = data;
      return this;
    },
    emit(event: string, data?: any) {
      postMessage({ type: event, content: data });
    },
  };
};
export const handler = getVscodeEvent();

export function isCompose(e: KeyboardEvent) {
  return e.metaKey || e.ctrlKey;
}
