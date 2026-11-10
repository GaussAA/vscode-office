/**
 * Standalone harness for the webviews.
 *
 * The extension normally injects a `postMessage` bridge and a theme. Here we serve the
 * built HTML from `out/webview` and fake that bridge in the page, so the real bundles run
 * without VS Code. Parquet fixtures are served with Range support and counted in `/stats`,
 * which is how the lazy-loading behaviour is asserted.
 */
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import * as XLSX from "xlsx";
import { repoRoot } from "./fixtures.mjs";

const WEBVIEW_ROOT = join(repoRoot, "out", "webview");

/**
 * The policy this harness enforces must be the policy the extension ships, or the negative
 * verification is theatre: editing `src/common/webviewCsp.ts` has to change this run.
 *
 * `scripts/ui-verify/` is plain `.mjs` executed by Node, and the real builder is TypeScript,
 * so bundle it once at startup rather than keeping a second copy of the directive list here.
 * It used to be a copy — which meant "remove 'unsafe-inline' and the suite turns red" was
 * only ever true by accident.
 */
const shellHelpers = mkdtempSync(join(tmpdir(), "ovp-webview-shell-"));
await build({
  entryPoints: [
    join(repoRoot, "src", "common", "webviewCsp.ts"),
    join(repoRoot, "src", "common", "webviewBase.ts"),
  ],
  outdir: shellHelpers,
  outExtension: { ".js": ".mjs" },
  bundle: true,
  format: "esm",
  platform: "node",
  logLevel: "silent",
});
const { buildWebviewCsp } = await import(pathToFileURL(join(shellHelpers, "webviewCsp.mjs")).href);
const { applyWebviewBase } = await import(
  pathToFileURL(join(shellHelpers, "webviewBase.mjs")).href
);
await rmSync(shellHelpers, { recursive: true, force: true });

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

const DARK = `:root{
--vscode-editor-background:#1f1f1f;--vscode-foreground:#cccccc;
--vscode-editorGroupHeader-tabsBackground:#181818;--vscode-panel-border:#2b2b2b;--vscode-widget-border:#313131;
--vscode-list-hoverBackground:#2a2d2e;--vscode-list-activeSelectionBackground:#04395e;--vscode-list-activeSelectionForeground:#ffffff;
--vscode-descriptionForeground:#9d9d9d;--vscode-errorForeground:#f85149;--vscode-editorWarning-foreground:#cca700;
--vscode-input-background:#313131;--vscode-input-foreground:#cccccc;--vscode-input-border:#3c3c3c;
--vscode-button-background:#0078d4;--vscode-button-foreground:#ffffff;--vscode-button-hoverBackground:#026ec1;
--vscode-charts-blue:#3794ff;--vscode-charts-green:#89d185;--vscode-charts-red:#f14c4c;--vscode-charts-orange:#d18616;
--vscode-charts-purple:#b180d7;--vscode-charts-teal:#4db6ac;--vscode-charts-yellow:#cca700;
--vscode-symbolIcon-propertyForeground:#cccccc;--vscode-editor-font-family:Consolas,monospace;--vscode-editor-font-size:13px;
--vscode-font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;--vscode-font-size:13px;
--vscode-scrollbarSlider-background:rgba(121,121,121,0.4);--vscode-textLink-foreground:#4daafc;
--vscode-editorWidget-background:#202020;--vscode-sideBar-background:#181818;
--vscode-focusBorder:#0078d4;--vscode-textCodeBlock-background:#2b2b2b;
--vscode-gitDecoration-modifiedResourceForeground:#e2c08d;--vscode-disabledForeground:#8a8a8a;
}
body{background:#1f1f1f;color:#cccccc}`;

const LIGHT = `:root{
--vscode-editor-background:#ffffff;--vscode-foreground:#3b3b3b;
--vscode-editorGroupHeader-tabsBackground:#f8f8f8;--vscode-panel-border:#e5e5e5;--vscode-widget-border:#e5e5e5;
--vscode-list-hoverBackground:#f2f2f2;--vscode-list-activeSelectionBackground:#0060c0;--vscode-list-activeSelectionForeground:#ffffff;
--vscode-descriptionForeground:#717171;--vscode-errorForeground:#e51400;--vscode-editorWarning-foreground:#bf8803;
--vscode-input-background:#ffffff;--vscode-input-foreground:#3b3b3b;--vscode-input-border:#cecece;
--vscode-button-background:#005fb8;--vscode-button-foreground:#ffffff;--vscode-button-hoverBackground:#0258a8;
--vscode-charts-blue:#1a85ff;--vscode-charts-green:#388a34;--vscode-charts-red:#e51400;--vscode-charts-orange:#d18616;
--vscode-charts-purple:#652d90;--vscode-charts-teal:#008a7a;--vscode-charts-yellow:#bf8803;
--vscode-symbolIcon-propertyForeground:#0451a5;--vscode-editor-font-family:Consolas,monospace;--vscode-editor-font-size:13px;
--vscode-font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;--vscode-font-size:13px;
--vscode-textLink-foreground:#006ab1;--vscode-editorWidget-background:#ffffff;--vscode-sideBar-background:#f8f8f8;
--vscode-focusBorder:#005fb8;--vscode-textCodeBlock-background:#f2f2f2;
--vscode-gitDecoration-modifiedResourceForeground:#bf8803;--vscode-disabledForeground:#8a8a8a;
}
body{background:#ffffff;color:#3b3b3b}`;

/** Heterogeneous JSONL: objects, arrays, nesting, null, invalid, empty, too-large, wrap, big. */
function jsonlFixtures() {
  const longMessage =
    "这是一条很长的日志消息，用来验证换行渲染是否正常工作。".repeat(6) +
    " tail-marker-abcdefghijklmnopqrstuvwxyz";
  const sample = [
    { id: 1, user: { name: "alpha", tags: ["a", "b"], active: true }, score: 9.5, note: null },
    { id: 2, events: [{ type: "click", ts: "2026-11-05T10:00:00Z" }], ok: true },
    null,
    null,
    {
      id: 5,
      nested: { a: { b: { c: { d: 1 } } } },
      msg: "a rather long string value that should be truncated in the directory preview because it does not fit",
    },
    { ts: "2026-11-05T09:59:00Z", level: "INFO", msg: "processed 1200 rows" },
    { name: "delta", payload: [1, 2, 3, 4, 5] },
    { _id: "abc123", value: 42 },
    {
      id: 9,
      list: [
        [1, 2],
        [3, 4],
      ],
      map: { k1: "v1", k2: "v2" },
    },
    { id: 10, flag: false, empty: "", zero: 0 },
    null,
    { id: 12, unicode: "中文测试 🎉" },
    {
      id: 11,
      level: "WARN",
      message: longMessage,
      context: { service: "ingest", attempt: 3, latencyMs: 1284.5 },
    },
  ];
  const bigEntry = {};
  for (let i = 0; i < 600; i++) bigEntry[`key_${i}`] = `value-${i}`;
  sample.push(bigEntry);

  return sample.map((value, index) => {
    if (index === 2) {
      return {
        index,
        kind: "invalid",
        raw: '{"id":3, broken',
        text: '{"id":3, broken',
        size: 15,
        error: "Unexpected token b in JSON at position 9",
      };
    }
    if (index === 3) {
      return { index, kind: "empty", raw: "", text: "", size: 0 };
    }
    if (index === 10) {
      return {
        index,
        kind: "too-large",
        raw: '{"blob":"AAAA…',
        text: `{"blob":"${"A".repeat(400)}"}`,
        size: 900 * 1024,
      };
    }
    const text = JSON.stringify(value);
    const label =
      value && typeof value === "object"
        ? (value.id ?? value._id ?? value.name ?? value.ts)
        : undefined;
    return {
      index,
      kind: "value",
      raw: text,
      text,
      size: text.length,
      label: label === undefined ? undefined : String(label),
      value,
    };
  });
}

function jsonlStub(fixtures) {
  const summaries = fixtures.map(({ index, kind, raw, size, label, error }) => ({
    index,
    kind,
    raw,
    size,
    label,
    error,
  }));
  return `<script>
(function () {
  const summaries = ${JSON.stringify(summaries)};
  const fixtures = ${JSON.stringify(fixtures)};
  const cancelled = new Set();
  const api = {
    postMessage(msg) {
      if (!msg) return;
      if (msg.type === 'init') {
        setTimeout(function () {
          window.postMessage({ type: 'jsonlInfo', content: { fileName: 'events.jsonl', cacheId: 'demo:file', lineCount: summaries.length, byteSize: summaries.length ? 73482 : 0 } }, '*');
        }, 60);
      }
      if (msg.type === 'jsonlIndex') {
        const requestId = msg.content.requestId;
        const start = msg.content.start, end = msg.content.end;
        setTimeout(function () {
          window.postMessage({ type: 'jsonlEntries', content: { requestId, start, entries: summaries.slice(start, end) } }, '*');
        }, 60);
      }
      if (msg.type === 'jsonlSearchCancel') {
        cancelled.add(msg.content.requestId);
      }
      if (msg.type === 'jsonlSearch') {
        const requestId = msg.content.requestId;
        const q = String(msg.content.query || '').toLowerCase();
        const matched = summaries.filter(function (s) { return (s.raw || '').toLowerCase().indexOf(q) >= 0; }).map(function (s) {
          const text = s.raw || '';
          const at = text.toLowerCase().indexOf(q);
          const snippet = at < 0 ? undefined : (at > 24 ? '…' : '') + text.slice(Math.max(0, at - 24), at + q.length + 24) + (at + q.length + 24 < text.length ? '…' : '');
          return Object.assign({}, s, { snippet: snippet });
        });
        const head = matched.slice(0, 3);
        setTimeout(function () {
          if (cancelled.has(requestId)) return;
          window.postMessage({ type: 'jsonlSearchBatch', content: { requestId: requestId, query: q, entries: head, scanned: Math.floor(summaries.length / 2), total: summaries.length, matches: head.length, done: false, capped: false } }, '*');
        }, 80);
        setTimeout(function () {
          if (cancelled.has(requestId)) return;
          window.postMessage({ type: 'jsonlSearchBatch', content: { requestId: requestId, query: q, entries: matched.slice(3), scanned: summaries.length, total: summaries.length, matches: matched.length, done: true, capped: false } }, '*');
        }, 200);
      }
      if (msg.type === 'jsonlEntry') {
        const requestId = msg.content.requestId;
        const index = msg.content.index;
        setTimeout(function () {
          window.postMessage({ type: 'jsonlEntryData', content: { requestId, index, entry: fixtures[index] } }, '*');
        }, 60);
      }
    },
    getState() { return undefined; },
    setState() {},
  };
  window.acquireVsCodeApi = function () { return api; };
})();
</script>`;
}

function parquetStub(fixtures) {
  // A virtual document arrives inline; the host sends it base64-encoded because a `number[]`
  // costs 5-8x the file on the JSON bridge. `?inline=1` exercises that decode path.
  const inlineBase64 = readFileSync(fixtures.mixed).toString("base64");
  return `<script>
(function () {
  window.__openExternalCalls = [];
  const api = {
    postMessage(msg) {
      if (!msg) return;
      if (msg.type === 'openExternal') {
        window.__openExternalCalls.push(String(msg.content));
        return;
      }
      const params = new URLSearchParams(location.search);
      const guard = params.get('guard') === '1';
      // "Open anyway" for a gated virtual document: the host reads it and sends it inline.
      if (guard && msg.type === 'openForce') {
        setTimeout(function () {
          window.postMessage({ type: 'open', content: { path: '', fileName: 'big-virtual.parquet', documentCacheId: 'demo-guard', size: 80 * 1024 * 1024, bufferBase64: ${JSON.stringify(inlineBase64)} } }, '*');
        }, 40);
        return;
      }
      if (msg.type !== 'init') return;
      const file = params.get('big') === '1' ? '/big.parquet'
        : params.get('mixed') === '1' ? '/mixed.parquet'
        : params.get('nested') === '1' ? '/nested.parquet'
        : params.get('empty') === '1' ? '/empty.parquet'
        : params.get('types') === '1' ? '/types.parquet'
        : params.get('preview') === '1' ? '/preview.parquet'
        : params.get('bad') === '1' ? '/bad.parquet'
        : '/sample.parquet';
      const suffix = params.get('range') === 'off' ? '?range=off' : '';
      const inline = params.get('inline') === '1';
      const payload = inline
        ? { path: '', fileName: 'inline-mixed.parquet', documentCacheId: 'demo-inline', bufferBase64: ${JSON.stringify(inlineBase64)} }
        : { path: file + suffix, fileName: 'parquet-sample', documentCacheId: 'demo' };
      if (guard) {
        setTimeout(function () {
          window.postMessage({ type: 'open', content: { path: '', fileName: 'big-virtual.parquet', documentCacheId: 'demo-guard', size: 80 * 1024 * 1024, tooLarge: true } }, '*');
        }, 80);
        return;
      }
      setTimeout(function () {
        window.postMessage({ type: 'open', content: payload }, '*');
      }, 80);
    },
    getState() { return undefined; },
    setState() {},
  };
  window.acquireVsCodeApi = function () { return api; };
})();
</script>`;
}

function serveParquet(req, res, file, stats, supportRange) {
  if (!file || !existsSync(file)) {
    res.writeHead(404).end("missing fixture");
    return;
  }
  const data = readFileSync(file);
  const range = req.headers.range;
  if (supportRange && range) {
    const match = /bytes=(\d+)-(\d*)/.exec(String(range));
    if (match) {
      const start = Number(match[1]);
      const end = match[2] ? Number(match[2]) : data.length - 1;
      const chunk = data.subarray(start, end + 1);
      stats.ranged++;
      res.writeHead(206, {
        "content-type": "application/octet-stream",
        "content-range": `bytes ${start}-${end}/${data.length}`,
        "accept-ranges": "bytes",
        "content-length": chunk.length,
      });
      res.end(chunk);
      return;
    }
  }
  stats.full++;
  res.writeHead(200, {
    "content-type": "application/octet-stream",
    "content-length": data.length,
    ...(supportRange ? { "accept-ranges": "bytes" } : {}),
  });
  res.end(data);
}

/**
 * Smoke bridge for the upstream viewers: answer `init` with an empty file so the view
 * mounts. It is not a rendering test — it catches import-time and mount-time crashes
 * introduced by fork-wide changes (entry, provider, shared utils).
 */
function smokeStub(route) {
  const name =
    {
      excel: "smoke.xlsx",
      word: "smoke.docx",
      ppt: "smoke.pptx",
      pdf: "smoke.pdf",
      archive: "smoke.zip",
      image: "smoke.png",
      html: "smoke.html",
      font: "smoke.ttf",
    }[route] ?? "smoke.bin";
  return `<script>
(function () {
  const api = {
    postMessage(msg) {
      if (!msg || msg.type !== 'init') return;
      setTimeout(function () {
        const content = ${JSON.stringify(name)} === 'smoke.ttf'
          ? { fileName: 'smoke.ttf', path: '/codicon.ttf', readOnly: true }
          : ${JSON.stringify(name)} === 'smoke.docx'
            ? { fileName: 'smoke.docx', path: '/smoke.docx', readOnly: true }
            : { fileName: ${JSON.stringify(name)}, path: '/${name}', buffer: [], content: '', readOnly: true };
        window.postMessage({ type: 'open', content: content }, '*');
      }, 60);
    },
    getState() { return undefined; },
    setState() {},
  };
  window.acquireVsCodeApi = function () { return api; };
})();
</script>`;
}

/**
 * Bridge for the spreadsheet size guard: a `file:` payload that claims to be 900 MB.
 *
 * The guard is a payload decision, not a file decision — the viewer must refuse before it
 * fetches anything — so a stub that lies about `size` tests it without committing a large
 * fixture. `/huge.csv` is a three-line CSV, so "Open anyway" can prove it really loads.
 */
function excelGuardStub() {
  return `<script>
(function () {
  const api = {
    postMessage(msg) {
      if (!msg || msg.type !== 'init') return;
      setTimeout(function () {
        window.postMessage({ type: 'open', content: {
          ext: '.csv',
          fileName: 'huge.csv',
          path: '/huge.csv',
          scheme: 'file',
          size: 900 * 1024 * 1024,
          readOnly: true,
          documentCacheId: 'demo:huge',
        } }, '*');
      }, 60);
    },
    getState() { return undefined; },
    setState() {},
  };
  window.acquireVsCodeApi = function () { return api; };
})();
</script>`;
}

/**
 * Bridge for the large-file windowed view: a `file:` payload just under the size guard, so the
 * viewer picks the read-only window instead of the editable grid.
 */
function excelWindowStub() {
  return `<script>
(function () {
  const api = {
    postMessage(msg) {
      if (!msg || msg.type !== 'init') return;
      setTimeout(function () {
        window.postMessage({ type: 'open', content: {
          ext: '.csv',
          fileName: 'window.csv',
          path: '/window.csv',
          scheme: 'file',
          size: 12 * 1024 * 1024,
          readOnly: true,
          documentCacheId: 'demo:window',
        } }, '*');
      }, 60);
    },
    getState() { return undefined; },
    setState() {},
  };
  window.acquireVsCodeApi = function () { return api; };
})();
</script>`;
}

/**
 * The windowed view's workbook: two sheets, generated once with SheetJS.
 *
 * Committing a binary fixture would hide what the test depends on; generating it here keeps the
 * row contents visible next to the assertions.
 */
function windowXlsx() {
  const data = [["id", "name", "score", "ok"]];
  for (let row = 0; row < 200; row++)
    data.push([String(row), `row-${row}`, String(row / 2), String(row % 2 === 0)]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(data), "Data");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["a"], ["b"], ["c"]]), "Extra");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

const WINDOW_XLSX = windowXlsx();

/** The same idea for a legacy workbook: `.xls` is decoded by SheetJS, not ExcelJS. */
function windowXls() {
  const data = [["id", "name"]];
  for (let row = 0; row < 50; row++) data.push([String(row), `legacy-${row}`]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(data), "Old");
  return XLSX.write(workbook, { type: "buffer", bookType: "biff8" });
}

const WINDOW_XLS = windowXls();

/**
 * Bridge for a workbook that must open in the windowed view: 12 MB claimed, just under the
 * 15 MB workbook guard and over the 8 MB window threshold.
 */
function excelWorkbookStub() {
  return `<script>
(function () {
  const api = {
    postMessage(msg) {
      if (!msg || msg.type !== 'init') return;
      setTimeout(function () {
        window.postMessage({ type: 'open', content: {
          ext: '.xlsx',
          fileName: 'window.xlsx',
          path: '/window.xlsx',
          scheme: 'file',
          size: 12 * 1024 * 1024,
          readOnly: true,
          documentCacheId: 'demo:window-xlsx',
        } }, '*');
      }, 60);
    },
    getState() { return undefined; },
    setState() {},
  };
  window.acquireVsCodeApi = function () { return api; };
})();
</script>`;
}

/** Bridge for a legacy workbook: `.xls` at 12 MB, windowed through SheetJS. */
function excelLegacyStub() {
  return `<script>
(function () {
  const api = {
    postMessage(msg) {
      if (!msg || msg.type !== 'init') return;
      setTimeout(function () {
        window.postMessage({ type: 'open', content: {
          ext: '.xls',
          fileName: 'window.xls',
          path: '/window.xls',
          scheme: 'file',
          size: 12 * 1024 * 1024,
          readOnly: true,
          documentCacheId: 'demo:window-xls',
        } }, '*');
      }, 60);
    },
    getState() { return undefined; },
    setState() {},
  };
  window.acquireVsCodeApi = function () { return api; };
})();
</script>`;
}

export function startHarness(fixtures, port = 0) {
  if (!existsSync(join(WEBVIEW_ROOT, "index.html"))) {
    throw new Error("out/webview/index.html is missing — run `pnpm build` first");
  }
  const indexHtml = readFileSync(join(WEBVIEW_ROOT, "index.html"), "utf8");
  const entries = jsonlFixtures();
  const stats = { ranged: 0, full: 0 };

  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const path = url.pathname;

    if (path === "/stats") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(stats));
      return;
    }

    if (path === "/harness" || path === "/harness-parquet" || path === "/harness-route") {
      const route =
        path === "/harness-parquet"
          ? "parquet"
          : path === "/harness-route"
            ? (url.searchParams.get("route") ?? "html")
            : "jsonl";
      const theme = url.searchParams.get("theme") === "light" ? LIGHT : DARK;
      const guard = path === "/harness-route" && url.searchParams.get("guard") === "1";
      const windowed = path === "/harness-route" && url.searchParams.get("window") === "1";
      const workbookView = path === "/harness-route" && url.searchParams.get("workbook") === "1";
      const legacyView = path === "/harness-route" && url.searchParams.get("legacy") === "1";
      const stub = guard
        ? excelGuardStub()
        : legacyView
          ? excelLegacyStub()
          : workbookView
            ? excelWorkbookStub()
            : windowed
              ? excelWindowStub()
              : path === "/harness-route"
                ? smokeStub(url.searchParams.get("route") ?? "html")
                : route === "parquet"
                  ? parquetStub(fixtures)
                  : jsonlStub(url.searchParams.get("empty") === "1" ? [] : entries);
      // The real policy, from `src/common/webviewCsp.ts`. The only local addition is the
      // nonce: the injected stub is inline, and production has no inline script at all.
      const origin = `http://${req.headers.host}`;
      const nonce = randomBytes(16).toString("base64");
      const csp = buildWebviewCsp(origin).replace(
        `script-src ${origin} `,
        `script-src ${origin} 'nonce-${nonce}' `,
      );
      // Same helper the extension uses: a shell whose `<base>` cannot be rewritten makes this
      // run fail, which is the point — the alternative is a green suite and a black webview.
      const html = applyWebviewBase(indexHtml, origin)
        .replace(
          /<meta id="office-configs"[^>]*>/,
          `<meta id="office-configs" data-config='${JSON.stringify({ route })}'>`,
        )
        .replace("{{csp}}", csp)
        .replace(
          '<script type="module"',
          `<style>${theme}</style>\n${stub.replace("<script>", `<script nonce="${nonce}">`)}\n<script type="module"`,
        );
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }

    if (path === "/codicon.ttf") {
      const font = join(repoRoot, "node_modules", "@vscode", "codicons", "dist", "codicon.ttf");
      if (!existsSync(font)) {
        res.writeHead(404).end("missing font");
        return;
      }
      res.writeHead(200, { "content-type": "font/ttf" });
      res.end(readFileSync(font));
      return;
    }

    // The Word route fetches its document by path (`loadOfficeBuffer` throws on an empty
    // buffer), so the fixture has to be a real docx served over HTTP.
    if (path === "/smoke.docx") {
      res.writeHead(200, {
        "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });
      res.end(readFileSync(fixtures.docx));
      return;
    }

    // What the size guard's "Open anyway" loads: small enough that the grid proves the
    // retry happened, real enough that the CSV parser runs.
    if (path === "/huge.csv") {
      res.writeHead(200, { "content-type": "text/csv; charset=utf-8" });
      res.end("a,b,c\n1,2,3\n4,5,6\n");
      return;
    }

    if (path === "/window.xls") {
      res.writeHead(200, { "content-type": "application/vnd.ms-excel" });
      res.end(WINDOW_XLS);
      return;
    }

    if (path === "/window.xlsx") {
      res.writeHead(200, {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      res.end(WINDOW_XLSX);
      return;
    }

    // The windowed view's document: 5000 rows, so "only the viewport is in the DOM" and
    // "scrolling reaches the last row" are both observable.
    if (path === "/window.csv") {
      const lines = ["id,a,b,c,d,e,f,g"];
      for (let row = 0; row < 5000; row++) {
        lines.push(`r${row},1,2,3,4,5,6,7`);
      }
      res.writeHead(200, { "content-type": "text/csv; charset=utf-8" });
      res.end(lines.join("\n"));
      return;
    }

    if (
      path === "/sample.parquet" ||
      path === "/mixed.parquet" ||
      path === "/big.parquet" ||
      path === "/nested.parquet" ||
      path === "/empty.parquet" ||
      path === "/types.parquet" ||
      path === "/preview.parquet" ||
      path === "/bad.parquet"
    ) {
      const file =
        path === "/sample.parquet"
          ? fixtures.sample
          : path === "/mixed.parquet"
            ? fixtures.mixed
            : path === "/nested.parquet"
              ? fixtures.nested
              : path === "/empty.parquet"
                ? fixtures.empty
                : path === "/types.parquet"
                  ? fixtures.types
                  : path === "/preview.parquet"
                    ? fixtures.preview
                    : path === "/bad.parquet"
                      ? fixtures.bad
                      : fixtures.big;
      serveParquet(req, res, file, stats, url.searchParams.get("range") !== "off");
      return;
    }

    if (path.startsWith("/resource/")) {
      const asset = join(repoRoot, decodeURIComponent(path));
      if (!existsSync(asset)) {
        res.writeHead(404).end("not found");
        return;
      }
      res.writeHead(200, { "content-type": MIME[extname(asset)] ?? "application/octet-stream" });
      res.end(readFileSync(asset));
      return;
    }

    const file = join(WEBVIEW_ROOT, path.replace(/^\//, ""));
    if (!existsSync(file) || path.endsWith("/")) {
      res.writeHead(404).end("not found");
      return;
    }
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
    res.end(readFileSync(file));
  });

  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const actual = server.address().port;
      resolve({
        port: actual,
        url: `http://127.0.0.1:${actual}`,
        stats,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}
