/**
 * A test-side bridge to one custom-editor webview, built only from what VS Code itself
 * exposes: the Chromium remote-debugging port (see `.vscode-test.mjs`).
 *
 * Why this exists: the extension API can see that a custom editor tab exists, but not what is
 * inside it. Through the debugging port the test evaluates script in the webview and reads the
 * DOM and the viewer's own `performance` entries — which is how the host-cache suite tells a
 * cache hit from a rebuild.
 *
 * Nothing here touches `src/`.
 */
import * as http from "node:http";

/** Must match `--remote-debugging-port` in `.vscode-test.mjs`. */
export const DEBUG_PORT = 9339;

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

/** Runs in the outer webview frame; the inner frame is same-origin, so its document is reachable. */
const FRAME_READY = `(() => {
  const inner = document.querySelector('iframe');
  return !!(inner && inner.contentWindow && inner.contentDocument);
})()`;

export class WebviewBridge {
  private constructor(private readonly session: CdpSession) {}

  /**
   * Attach to the webview that appeared after `knownIds` was taken, and wait until its frame is
   * addressable. By then the host has answered `init` with `open`, so evaluating a cache measure
   * reads a settled viewer.
   */
  static async attachToNewWebview(knownIds: ReadonlySet<string>): Promise<WebviewBridge> {
    const target = await waitFor(
      async () => (await listWebviewTargets()).find((candidate) => !knownIds.has(candidate.id)),
      () => "no new webview target appeared on the debugging port",
    );
    const session = await CdpSession.connect(target.webSocketDebuggerUrl);
    const bridge = new WebviewBridge(session);
    await waitFor(
      () => session.evaluate<boolean>(FRAME_READY),
      () => "the webview inner frame never became reachable",
      60000,
    );
    return bridge;
  }

  static async knownTargetIds(): Promise<Set<string>> {
    return new Set((await listWebviewTargets()).map((target) => target.id));
  }

  /** Evaluate in the outer frame and return the value; the cache-hit tests poll DOM/perf here. */
  async evaluate<T>(expression: string): Promise<T> {
    return this.session.evaluate<T>(expression);
  }

  close(): void {
    this.session.close();
  }
}
