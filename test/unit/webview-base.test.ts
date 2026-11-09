import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { applyWebviewBase } from "@/common/webviewBase";

/**
 * The regression these pin: `reactApp.buildPath` matched `<base href="/">` byte for byte, a
 * formatter rewrote the tag to `<base href="/" />`, and the replacement silently stopped
 * happening — so every `./assets/*.js` resolved against the webview origin root, 404'd, and the
 * parquet viewer rendered a black page in the real host while every gate stayed green.
 *
 * The shell therefore has to be rewritten by *shape*, never by an exact byte sequence, and a
 * shell without the tag has to fail loudly instead of quietly serving a broken base.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const hosted = "vscode-webview://0d1f/out/webview";

test("webviewBase: rewrites the tag the way it looked before formatting", () => {
  const html = '<head><base href="/"><title>x</title></head>';
  // The rewrite normalises to a self-closing tag, which is what a formatter would produce and
  // therefore the shape that must survive every subsequent pass.
  assert.equal(
    applyWebviewBase(html, hosted),
    `<head><base href="${hosted}/" /><title>x</title></head>`,
  );
});

test("webviewBase: rewrites the self-closing tag a formatter produces", () => {
  // This exact shape is what oxfmt left behind, and what broke the parquet viewer.
  const html = '<head>\n    <base href="/" />\n    <title>x</title>\n  </head>';
  const result = applyWebviewBase(html, hosted);
  assert.ok(result.includes(`<base href="${hosted}/" />`), result);
  assert.ok(!result.includes('href="/"'), "the old base survived");
});

test("webviewBase: tolerates attribute spacing, quoting and case", () => {
  for (const tag of ['<base  href = "/" >', "<base href='/' />", '<BASE HREF="/">']) {
    assert.ok(
      applyWebviewBase(`<head>${tag}</head>`, hosted).includes(hosted),
      `did not rewrite: ${tag}`,
    );
  }
});

test("webviewBase: replaces the placeholder form too", () => {
  const html = '<base href="{{baseUrl}}/" />';
  assert.equal(applyWebviewBase(html, hosted), `<base href="${hosted}/" />`);
});

test("webviewBase: keeps exactly one trailing slash", () => {
  assert.ok(applyWebviewBase('<base href="/">', `${hosted}/`).includes(`href="${hosted}/"`));
  assert.ok(applyWebviewBase('<base href="/">', hosted).includes(`href="${hosted}/"`));
});

test("webviewBase: a shell without the tag throws instead of silently doing nothing", () => {
  assert.throws(() => applyWebviewBase("<head></head>", hosted), /no <base href>/);
});

test("webviewBase: the real shell can still be rewritten", () => {
  // Guards the shipped file, not just the helper: if the tag is renamed or dropped, the
  // extension would serve a webview whose own assets cannot resolve.
  const shell = readFileSync(join(root, "index.html"), "utf8");
  const result = applyWebviewBase(shell, hosted);
  assert.ok(result.includes(`<base href="${hosted}/"`), "the shipped index.html was not rewritten");
});
