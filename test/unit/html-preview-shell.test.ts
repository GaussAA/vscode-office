import assert from "node:assert/strict";
import test from "node:test";
import {
  PREVIEW_CONTENT_TYPE,
  PREVIEW_READY_TYPE,
  buildHtmlPreviewShell,
} from "@/service/htmlPreviewShell";

/**
 * The HTML preview renders documents we did not write. It used to assign the file
 * straight to `webview.html`, which put that document in the extension's own webview —
 * same storage as the other preview panels, `acquireVsCodeApi` in scope.
 *
 * The fix is structural: our markup stays in the webview, the document goes into a
 * sandboxed frame. These tests pin the property that makes that true, because a single
 * edit to the sandbox attribute silently turns it back off.
 */

const shell = buildHtmlPreviewShell();

test("shell: is a fixed document, not a template for the previewed file", () => {
  assert.equal(shell, buildHtmlPreviewShell());
  assert.ok(
    !shell.includes("srcdoc="),
    "the document must be injected at runtime, never baked into the shell",
  );
});

test("shell: contains exactly one frame", () => {
  const frames = shell.match(/<iframe\b/g) ?? [];
  assert.equal(frames.length, 1);
});

test("shell: the frame gets an opaque origin (allow-scripts, nothing else)", () => {
  const tag = /<iframe\b[^>]*>/.exec(shell);
  assert.ok(tag, "no <iframe> tag");
  assert.match(tag[0], /sandbox="allow-scripts"/);

  // Each of these would hand the previewed page some of the host's authority back.
  for (const permission of [
    "allow-same-origin",
    "allow-top-navigation",
    "allow-popups",
    "allow-modals",
    "allow-forms",
    "allow-downloads",
  ]) {
    assert.ok(!shell.includes(permission), `the frame must not be granted ${permission}`);
  }
});

test("shell: speaks the same message types as the extension side", () => {
  // The strings are duplicated into the page by JSON.stringify, so a rename that only
  // touches the constants would leave the frame waiting for a message that never comes.
  assert.ok(shell.includes(JSON.stringify(PREVIEW_READY_TYPE)));
  assert.ok(shell.includes(JSON.stringify(PREVIEW_CONTENT_TYPE)));
});

test("shell: no CSP, and that is deliberate", () => {
  // An about:srcdoc document inherits the embedder's policy, so a script-src here would
  // also block the page being previewed. If this ever changes, the preview has to be
  // re-verified against a real document with scripts.
  assert.ok(!shell.includes("Content-Security-Policy"));
});
