/**
 * The outer document for the HTML preview.
 *
 * The preview used to assign the user's file straight to `webview.html`, so the page ran
 * as the extension's own webview: same storage as every other preview panel and
 * `acquireVsCodeApi` in scope. The shell keeps our markup in the webview and moves the
 * document into a sandboxed frame instead — `allow-scripts` without `allow-same-origin`
 * gives it an opaque origin, so it still renders and runs its own scripts but cannot
 * reach the host page, its storage, or the message bridge.
 *
 * There is deliberately no CSP here. An `about:srcdoc` document inherits the embedder's
 * policy, so any `script-src` restriction would also block the very page we are asked to
 * preview. The frame's sandbox is the isolation boundary for this panel; the CSP work
 * tracked separately lives on the other viewers, which do not embed third-party documents.
 */

export const PREVIEW_CONTENT_TYPE = 'htmlPreview/content'
export const PREVIEW_READY_TYPE = 'htmlPreview/ready'

export function buildHtmlPreviewShell(): string {
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; height: 100%; }
  iframe { border: 0; width: 100%; height: 100%; background: #fff; }
</style>
</head>
<body>
<iframe id="preview" sandbox="allow-scripts" referrerpolicy="no-referrer"></iframe>
<script>
  (function () {
    var frame = document.getElementById('preview')
    var vscode = acquireVsCodeApi()
    window.addEventListener('message', function (event) {
      var message = event.data
      if (message && message.type === ${JSON.stringify(PREVIEW_CONTENT_TYPE)}) {
        frame.srcdoc = message.html
      }
    })
    vscode.postMessage({ type: ${JSON.stringify(PREVIEW_READY_TYPE)} })
  })()
</script>
</body>
</html>`
}
