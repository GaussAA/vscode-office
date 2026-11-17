/**
 * A test-side bridge to one custom-editor webview, built only from what VS Code itself
 * exposes: the Chromium remote-debugging port (see `.vscode-test.mjs`).
 *
 * Why this exists: the extension API cannot post a message *from* a webview, and the host
 * save rules in `commonHandler` / `saveHandlers` only run when the webview sends `change`,
 * `save` or `saveAs`. Through the debugging port the test evaluates script inside the
 * webview's outer frame and calls the same `__vscode_post_message__('onmessage', ...)` that
 * `acquireVsCodeApi().postMessage` ends in, so the message travels VS Code's real
 * webview -> extension-host channel and reaches `panel.webview.onDidReceiveMessage`.
 * In the other direction, a `message` listener in the inner frame records everything the
 * host `postMessage`s (`open`, `saveDone`, `saveFailed`).
 *
 * Nothing here touches `src/`. What it does NOT do is drive the Excel UI: an edit is the
 * `change` message the UI would send, not a cell being typed into the canvas.
 */
import * as http from "node:http";

/** Must match `--remote-debugging-port` in `.vscode-test.mjs`. */
export const DEBUG_PORT = 9339;

export interface HostMessage {
  type: string;
  /** Only the fields tests assert on; `open` payloads are not copied (they can be large). */
  reason?: string;
  message?: string;
}

interface DebugTarget {
  id: string;
  type: string;
  url: string;
  webSocketDebuggerUrl: string;
}

function getJson(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    http
      .get(url, (response) => {
        let body = "";
        response.on("data", (chunk) => (body += chunk));
        response.on("end", () => {
          try {
            resolve(JSON.parse(body));
          } catch (error) {
            reject(error);
          }
        });
      })
      .on("error", reject);
  });
}

async function listWebviewTargets(): Promise<DebugTarget[]> {
  const all = (await getJson(`http://127.0.0.1:${DEBUG_PORT}/json/list`)) as DebugTarget[];
  return all.filter((target) => target.type === "iframe" && target.url.includes("vscode-webview:"));
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Poll `probe` until it returns a truthy value; throw `describe()` on timeout. */
export async function waitFor<T>(
  probe: () => T | Promise<T>,
  describe: () => string,
  timeoutMs = 30000,
): Promise<NonNullable<T>> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value) return value as NonNullable<T>;
    if (Date.now() > deadline) throw new Error(`timed out after ${timeoutMs} ms: ${describe()}`);
    await sleep(100);
  }
}

class CdpSession {
  private nextId = 0;
  private readonly pending = new Map<number, (message: any) => void>();
  private closedReason: string | undefined;

  private constructor(private readonly socket: WebSocket) {
    socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== undefined) this.pending.get(message.id)?.(message);
    };
    // A hidden custom editor loses its webview (no retainContextWhenHidden), which closes the
    // target's socket. Fail the calls in flight instead of leaving them hanging.
    socket.onclose = () => {
      this.closedReason = "the webview target went away (the editor was hidden or closed)";
      for (const resolve of this.pending.values()) {
        resolve({ error: { message: this.closedReason } });
      }
    };
  }

  static async connect(url: string): Promise<CdpSession> {
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      socket.onopen = () => resolve();
      socket.onerror = () => reject(new Error(`cannot connect to ${url}`));
    });
    return new CdpSession(socket);
  }

  async evaluate<T>(expression: string, timeoutMs = 20000): Promise<T> {
    if (this.closedReason) throw new Error(`webview evaluation failed: ${this.closedReason}`);
    const id = ++this.nextId;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const reply = await new Promise<any>((resolve) => {
      timer = setTimeout(
        () => resolve({ error: { message: `no reply within ${timeoutMs} ms` } }),
        timeoutMs,
      );
      this.pending.set(id, resolve);
      this.socket.send(
        JSON.stringify({
          id,
          method: "Runtime.evaluate",
          params: { expression, returnByValue: true, awaitPromise: true },
        }),
      );
    });
    clearTimeout(timer);
    this.pending.delete(id);
    if (reply.error || reply.result?.exceptionDetails) {
      throw new Error(`webview evaluation failed: ${JSON.stringify(reply.error ?? reply.result)}`);
    }
    return reply.result.result.value as T;
  }

  close(): void {
    this.socket.close();
  }
}
// Runs in the outer webview frame. The inner frame is same-origin, so its window is reachable.
const INSTALL_RECORDER = `(() => {
  const inner = document.querySelector('iframe');
  const win = inner && inner.contentWindow;
  if (!win || !inner.contentDocument || !inner.contentDocument.querySelector('canvas')) return false;
  if (!win.__hostLog) {
    win.__hostLog = [];
    win.addEventListener('message', (event) => {
      const data = event.data;
      if (!data || typeof data.type !== 'string') return;
      const entry = { type: data.type };
      if (data.content && typeof data.content === 'object') {
        if (typeof data.content.reason === 'string') entry.reason = data.content.reason;
        if (typeof data.content.message === 'string') entry.message = data.content.message;
      }
      win.__hostLog.push(entry);
    });
  }
  return true;
})()`;

export class WebviewBridge {
  private constructor(private readonly session: CdpSession) {}

  /**
   * Attach to the webview that appeared after `knownIds` was taken, and wait until the Excel
   * canvas is rendered. By then the host has answered `init` with `open`, so the host-side
   * `send()` has finished and a later `change` cannot be overwritten by it.
   */
  static async attachToNewWebview(knownIds: ReadonlySet<string>): Promise<WebviewBridge> {
    const target = await waitFor(
      async () => (await listWebviewTargets()).find((candidate) => !knownIds.has(candidate.id)),
      () => "no new webview target appeared on the debugging port",
    );
    const session = await CdpSession.connect(target.webSocketDebuggerUrl);
    const bridge = new WebviewBridge(session);
    await waitFor(
      () => session.evaluate<boolean>(INSTALL_RECORDER),
      () => "the Excel canvas never rendered inside the webview",
      60000,
    );
    return bridge;
  }

  static async knownTargetIds(): Promise<Set<string>> {
    return new Set((await listWebviewTargets()).map((target) => target.id));
  }

  /** Post a message the way the viewer's `handler.emit(type, content)` does. */
  async post(type: string, content?: unknown): Promise<void> {
    const message = JSON.stringify({ type, content });
    await this.session.evaluate<boolean>(
      `(window.__vscode_post_message__('onmessage', { message: ${message} }), true)`,
    );
  }

  /**
   * Run a script in the outer webview frame. Used when several messages must leave the
   * webview back to back (no round trip to the test in between) or when a payload is better
   * generated there than serialised through the debugging port.
   */
  async run(expression: string): Promise<void> {
    await this.session.evaluate<unknown>(expression);
  }

  /** Everything the host has posted to this webview since the recorder was installed. */
  async received(): Promise<HostMessage[]> {
    return this.session.evaluate<HostMessage[]>(
      `(() => { const w = document.querySelector('iframe').contentWindow; return w.__hostLog || []; })()`,
    );
  }

  async count(type: string): Promise<number> {
    return (await this.received()).filter((entry) => entry.type === type).length;
  }

  close(): void {
    this.session.close();
  }
}
