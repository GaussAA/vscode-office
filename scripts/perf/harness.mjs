/**
 * HTTP harness for the performance gate.
 *
 * Deliberately separate from `scripts/ui-verify/harness.mjs`: that one answers "does the
 * DOM look right" and serves small fixtures through a shared `/stats` request counter; this
 * one answers "how many bytes did the first paint cost and how long did a search take", so
 * it serves large one-row-group files and accounts for *bytes*, not requests. Sharing one
 * server between the two would tie two suites' lifetimes together for ~60 lines of plumbing.
 *
 * The page is the real built webview (`out/webview`) with a fake `acquireVsCodeApi` bridge,
 * exactly like the UI suite, so the numbers come from the shipped bundle.
 */
import { randomBytes } from "node:crypto";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { repoRoot } from "../ui-verify/fixtures.mjs";

const WEBVIEW_ROOT = join(repoRoot, "out", "webview");

const MIME = {
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".html": "text/html",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
};

/** Same shell CSS the UI suite injects, so antd lays out at a realistic size. */
const DARK = `:root{
--vscode-editor-background:#1f1f1f;--vscode-foreground:#cccccc;--vscode-panel-border:#2b2b2b;
--vscode-widget-border:#313131;--vscode-list-hoverBackground:#2a2d2e;--vscode-descriptionForeground:#9d9d9d;
--vscode-input-background:#313131;--vscode-input-foreground:#cccccc;--vscode-input-border:#3c3c3c;
--vscode-button-background:#0078d4;--vscode-button-foreground:#ffffff;--vscode-charts-blue:#3794ff;
--vscode-editor-font-family:Consolas,monospace;--vscode-editor-font-size:13px;
--vscode-font-family:'Segoe UI',sans-serif;--vscode-font-size:13px;--vscode-textLink-foreground:#4daafc;
--vscode-editorWidget-background:#202020;--vscode-focusBorder:#0078d4;--vscode-disabledForeground:#8a8a8a;
}
body{background:#1f1f1f;color:#cccccc}`;

/**
 * The policy enforced here must be the one the extension ships, so it is bundled from
 * `src/common/webviewCsp.ts` instead of being copied.
 */
async function loadCspBuilder() {
  const dir = mkdtempSync(join(tmpdir(), "ovp-perf-shell-"));
  await build({
    entryPoints: [join(repoRoot, "src", "common", "webviewCsp.ts")],
    outdir: dir,
    outExtension: { ".js": ".mjs" },
    bundle: true,
    format: "esm",
    platform: "node",
    logLevel: "silent",
  });
  const module = await import(pathToFileURL(join(dir, "webviewCsp.mjs")).href);
  rmSync(dir, { recursive: true, force: true });
  return module.buildWebviewCsp;
}

/**
 * Fake bridge + in-page stopwatch.
 *
 * `t0` is taken immediately before the fake host posts `open`; `ready` is taken once the
 * table has a real cell and the pager is on screen, two frames later. Measuring inside the
 * page keeps DevTools round-trip time out of the number.
 */
function harnessPage(openPayload) {
  return `<script>
(function () {
  window.__bench = { t0: 0, ready: 0, open: ${JSON.stringify(openPayload)} };
  const api = {
    postMessage(message) {
      if (!message || message.type !== 'init') return;
      setTimeout(function () {
        window.__bench.t0 = performance.now();
        window.postMessage({ type: 'open', content: window.__bench.open }, '*');
      }, 80);
    },
    getState() { return undefined; },
    setState() {},
  };
  window.acquireVsCodeApi = function () { return api; };

  const timer = setInterval(function () {
    if (!window.__bench.t0 || window.__bench.ready) return;
    const painted = document.querySelector('.parquet-viewer__cell')?.textContent
      && document.querySelector('.parquet-viewer__pager-info');
    if (!painted) return;
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        clearInterval(timer);
        window.__bench.ready = performance.now();
      });
    });
  }, 8);
})();
</script>`;
}

export async function startPerfHarness(fixtures, port = 0) {
  if (!existsSync(join(WEBVIEW_ROOT, "index.html"))) {
    throw new Error("out/webview/index.html is missing — run `pnpm build` first");
  }
  const indexHtml = readFileSync(join(WEBVIEW_ROOT, "index.html"), "utf8");
  const buildWebviewCsp = await loadCspBuilder();

  let stats = { requests: 0, ranged: 0, full: 0, bytes: 0 };
  const reset = () => {
    stats = { requests: 0, ranged: 0, full: 0, bytes: 0 };
  };
  const snapshot = () => ({ ...stats });

  const files = new Map([
    ["/f/flat.parquet", fixtures.flat],
    ["/f/wide.parquet", fixtures.wide],
  ]);

  function serveFile(req, res, file) {
    if (!existsSync(file)) {
      res.writeHead(404).end("missing fixture");
      return;
    }
    const size = statSync(file).size;
    const range = req.headers.range;
    const match = range ? /bytes=(\d+)-(\d*)/.exec(String(range)) : null;
    if (match) {
      const start = Number(match[1]);
      const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
      stats.requests++;
      stats.ranged++;
      stats.bytes += end - start + 1;
      res.writeHead(206, {
        "content-type": "application/octet-stream",
        "content-range": `bytes ${start}-${end}/${size}`,
        "accept-ranges": "bytes",
        "content-length": end - start + 1,
      });
      createReadStream(file, { start, end }).pipe(res);
      return;
    }
    stats.requests++;
    stats.full++;
    stats.bytes += size;
    res.writeHead(200, {
      "content-type": "application/octet-stream",
      "content-length": size,
      "accept-ranges": "bytes",
    });
    createReadStream(file).pipe(res);
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const path = url.pathname;

    if (path === "/stats") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(stats));
      return;
    }
    if (path === "/stats/reset") {
      reset();
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (path === "/harness") {
      const file = url.searchParams.get("file") ?? "flat";
      const origin = `http://${req.headers.host}`;
      const nonce = randomBytes(16).toString("base64");
      const target = file === "wide" ? "/f/wide.parquet" : "/f/flat.parquet";
      const name = target.split("/").pop();
      const openPayload = { path: target, fileName: name, documentCacheId: `perf:${name}` };
      const csp = buildWebviewCsp(origin).replace(
        `script-src ${origin} `,
        `script-src ${origin} 'nonce-${nonce}' `,
      );
      const html = indexHtml
        .replace(/<base\s+href\s*=\s*(["'])[^"']*\1\s*\/?>/i, `<base href="${origin}/" />`)
        .replace(
          /<meta id="office-configs"[^>]*>/,
          `<meta id="office-configs" data-config="${JSON.stringify({ route: "parquet", language: "en" }).replace(/"/g, "&quot;")}" />`,
        )
        .replace("{{csp}}", csp)
        .replace(
          '<script type="module"',
          `<style>${DARK}</style>\n${harnessPage(openPayload).replace("<script>", `<script nonce="${nonce}">`)}\n<script type="module"`,
        );
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }
    if (files.has(path)) {
      serveFile(req, res, files.get(path));
      return;
    }

    const asset = join(WEBVIEW_ROOT, path.replace(/^\//, ""));
    if (!existsSync(asset) || path.endsWith("/")) {
      res.writeHead(404).end("not found");
      return;
    }
    res.writeHead(200, { "content-type": MIME[extname(asset)] ?? "application/octet-stream" });
    res.end(readFileSync(asset));
  });

  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const actual = server.address().port;
      resolve({
        port: actual,
        url: `http://127.0.0.1:${actual}`,
        snapshot,
        reset,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}
