/**
 * Standalone harness for the webviews.
 *
 * The extension normally injects a `postMessage` bridge and a theme. Here we serve the
 * built HTML from `out/webview` and fake that bridge in the page, so the real bundles run
 * without VS Code. Parquet fixtures are served with Range support and counted in `/stats`,
 * which is how the lazy-loading behaviour is asserted.
 */
import { createServer } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { repoRoot } from './fixtures.mjs'

const WEBVIEW_ROOT = join(repoRoot, 'out', 'webview')

const MIME = {
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.html': 'text/html',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.wasm': 'application/wasm',
}

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
body{background:#1f1f1f;color:#cccccc}`

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
body{background:#ffffff;color:#3b3b3b}`

/** Heterogeneous JSONL: objects, arrays, nesting, null, invalid, empty, too-large, wrap, big. */
function jsonlFixtures() {
    const longMessage = '这是一条很长的日志消息，用来验证换行渲染是否正常工作。'.repeat(6)
        + ' tail-marker-abcdefghijklmnopqrstuvwxyz'
    const sample = [
        { id: 1, user: { name: 'alpha', tags: ['a', 'b'], active: true }, score: 9.5, note: null },
        { id: 2, events: [{ type: 'click', ts: '2026-11-05T10:00:00Z' }], ok: true },
        null,
        null,
        { id: 5, nested: { a: { b: { c: { d: 1 } } } }, msg: 'a rather long string value that should be truncated in the directory preview because it does not fit' },
        { ts: '2026-11-05T09:59:00Z', level: 'INFO', msg: 'processed 1200 rows' },
        { name: 'delta', payload: [1, 2, 3, 4, 5] },
        { _id: 'abc123', value: 42 },
        { id: 9, list: [[1, 2], [3, 4]], map: { k1: 'v1', k2: 'v2' } },
        { id: 10, flag: false, empty: '', zero: 0 },
        null,
        { id: 12, unicode: '中文测试 🎉' },
        { id: 11, level: 'WARN', message: longMessage, context: { service: 'ingest', attempt: 3, latencyMs: 1284.5 } },
    ]
    const bigEntry = {}
    for (let i = 0; i < 600; i++) bigEntry[`key_${i}`] = `value-${i}`
    sample.push(bigEntry)

    return sample.map((value, index) => {
        if (index === 2) {
            return { index, raw: '{"id":3, broken', text: '{"id":3, broken', size: 15, error: 'Unexpected token b in JSON at position 9' }
        }
        if (index === 3) {
            return { index, raw: '', text: '', size: 0, empty: true }
        }
        if (index === 10) {
            return { index, raw: '{"blob":"AAAA…', text: `{"blob":"${'A'.repeat(400)}"}`, size: 900 * 1024, tooLarge: true }
        }
        const text = JSON.stringify(value)
        const label = value && typeof value === 'object' ? (value.id ?? value._id ?? value.name ?? value.ts) : undefined
        return { index, raw: text, text, size: text.length, label: label === undefined ? undefined : String(label), value }
    })
}

function jsonlStub(fixtures) {
    const summaries = fixtures.map(({ index, raw, size, label, empty, error, tooLarge }) => ({
        index, raw, size, label, empty, error, tooLarge,
    }))
    return `<script>
(function () {
  const summaries = ${JSON.stringify(summaries)};
  const fixtures = ${JSON.stringify(fixtures)};
  const api = {
    postMessage(msg) {
      if (!msg) return;
      if (msg.type === 'init') {
        setTimeout(function () {
          window.postMessage({ type: 'jsonlInfo', content: { fileName: 'events.jsonl', cacheId: 'demo:file', lineCount: summaries.length, byteSize: 73482, readOnly: false } }, '*');
        }, 60);
      }
      if (msg.type === 'jsonlIndex') {
        const start = msg.content.start, end = msg.content.end;
        setTimeout(function () {
          window.postMessage({ type: 'jsonlEntries', content: { start, entries: summaries.slice(start, end) } }, '*');
        }, 60);
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
          window.postMessage({ type: 'jsonlSearchBatch', content: { requestId: requestId, query: q, entries: head, scanned: Math.floor(summaries.length / 2), total: summaries.length, matches: head.length, done: false, capped: false } }, '*');
        }, 80);
        setTimeout(function () {
          window.postMessage({ type: 'jsonlSearchBatch', content: { requestId: requestId, query: q, entries: matched.slice(3), scanned: summaries.length, total: summaries.length, matches: matched.length, done: true, capped: false } }, '*');
        }, 200);
      }
      if (msg.type === 'jsonlEntry') {
        const index = msg.content;
        setTimeout(function () {
          window.postMessage({ type: 'jsonlEntryData', content: { index, entry: fixtures[index] } }, '*');
        }, 60);
      }
    },
    getState() { return undefined; },
    setState() {},
  };
  window.acquireVsCodeApi = function () { return api; };
})();
</script>`
}

function parquetStub() {
    return `<script>
(function () {
  const api = {
    postMessage(msg) {
      if (!msg || msg.type !== 'init') return;
      const params = new URLSearchParams(location.search);
      const file = params.get('big') === '1' ? '/big.parquet' : params.get('mixed') === '1' ? '/mixed.parquet' : '/sample.parquet';
      const suffix = params.get('range') === 'off' ? '?range=off' : '';
      setTimeout(function () {
        window.postMessage({ type: 'open', content: { path: file + suffix, fileName: 'parquet-sample', documentCacheId: 'demo', readOnly: false } }, '*');
      }, 80);
    },
    getState() { return undefined; },
    setState() {},
  };
  window.acquireVsCodeApi = function () { return api; };
})();
</script>`
}

function serveParquet(req, res, file, stats, supportRange) {
    if (!file || !existsSync(file)) {
        res.writeHead(404).end('missing fixture')
        return
    }
    const data = readFileSync(file)
    const range = req.headers.range
    if (supportRange && range) {
        const match = /bytes=(\d+)-(\d*)/.exec(String(range))
        if (match) {
            const start = Number(match[1])
            const end = match[2] ? Number(match[2]) : data.length - 1
            const chunk = data.subarray(start, end + 1)
            stats.ranged++
            res.writeHead(206, {
                'content-type': 'application/octet-stream',
                'content-range': `bytes ${start}-${end}/${data.length}`,
                'accept-ranges': 'bytes',
                'content-length': chunk.length,
            })
            res.end(chunk)
            return
        }
    }
    stats.full++
    res.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': data.length,
        ...(supportRange ? { 'accept-ranges': 'bytes' } : {}),
    })
    res.end(data)
}

export function startHarness(fixtures, port = 0) {
    if (!existsSync(join(WEBVIEW_ROOT, 'index.html'))) {
        throw new Error('out/webview/index.html is missing — run `pnpm build` first')
    }
    const indexHtml = readFileSync(join(WEBVIEW_ROOT, 'index.html'), 'utf8')
    const entries = jsonlFixtures()
    const stats = { ranged: 0, full: 0 }

    const server = createServer((req, res) => {
        const url = new URL(req.url, 'http://127.0.0.1')
        const path = url.pathname

        if (path === '/stats') {
            res.writeHead(200, { 'content-type': 'application/json' })
            res.end(JSON.stringify(stats))
            return
        }

        if (path === '/harness' || path === '/harness-parquet') {
            const route = path === '/harness-parquet' ? 'parquet' : 'jsonl'
            const theme = url.searchParams.get('theme') === 'light' ? LIGHT : DARK
            const stub = route === 'parquet' ? parquetStub() : jsonlStub(entries)
            const html = indexHtml
                .replace(/<meta id="office-configs"[^>]*>/, `<meta id="office-configs" data-config='${JSON.stringify({ route })}'>`)
                .replace('<script type="module"', `<style>${theme}</style>\n${stub}\n<script type="module"`)
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
            res.end(html)
            return
        }

        if (path === '/sample.parquet' || path === '/mixed.parquet' || path === '/big.parquet') {
            const file = path === '/sample.parquet'
                ? fixtures.sample
                : path === '/mixed.parquet' ? fixtures.mixed : fixtures.big
            serveParquet(req, res, file, stats, url.searchParams.get('range') !== 'off')
            return
        }

        const file = join(WEBVIEW_ROOT, path.replace(/^\//, ''))
        if (!existsSync(file) || path.endsWith('/')) {
            res.writeHead(404).end('not found')
            return
        }
        res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
        res.end(readFileSync(file))
    })

    return new Promise((resolve, reject) => {
        server.on('error', reject)
        server.listen(port, '127.0.0.1', () => {
            const actual = server.address().port
            resolve({
                port: actual,
                url: `http://127.0.0.1:${actual}`,
                stats,
                close: () => new Promise(done => server.close(done)),
            })
        })
    })
}
