import assert from "node:assert/strict";
import test from "node:test";
import { buildWebviewCsp } from "@/common/webviewCsp";

/**
 * Every webview renders under this policy. It is asserted here rather than only exercised in a
 * browser because the failure mode is silent: a rule that blocks a stylesheet leaves the page
 * looking fine in a screenshot. `verify:ui` additionally fails a run on any CSP violation it
 * observes, which is what proves the policy is compatible with the remaining viewers.
 */

const ORIGIN = "vscode-webview://abc";
const csp = buildWebviewCsp(ORIGIN);
const directive = (name: string) =>
  csp.split("; ").find((part) => part.startsWith(`${name} `)) ?? "";

test("csp: denies by default", () => {
  assert.ok(csp.startsWith(`default-src 'none'`), csp);
});

test("csp: every resource class a viewer needs is spelled out for the webview origin", () => {
  for (const name of ["script-src", "style-src", "img-src", "font-src", "connect-src"]) {
    assert.ok(
      directive(name).includes(ORIGIN),
      `${name} does not allow the webview origin: ${directive(name)}`,
    );
  }
});

test("csp: inline styles and wasm are allowed, inline scripts and eval are not", () => {
  // antd is CSS-in-JS and injects <style> at runtime; removing this breaks every viewer.
  assert.ok(directive("style-src").includes(`'unsafe-inline'`));
  const scriptSrc = directive("script-src");
  // hyparquet-compressors decodes SNAPPY/ZSTD/BROTLI/LZ4 through WebAssembly.
  assert.ok(scriptSrc.includes(`'wasm-unsafe-eval'`), "parquet compression needs wasm");
  assert.ok(!scriptSrc.includes(`'unsafe-inline'`), "inline scripts must stay blocked");
  assert.ok(!scriptSrc.includes(`'unsafe-eval'`), "eval must stay blocked");
});

test("csp: directives that belonged to removed viewers are gone", () => {
  // media (audio/video in archives), frame (HTML preview / EPUB) and worker (pdf.js) were
  // relaxation points for viewers this extension no longer ships.
  for (const name of ["media-src", "frame-src", "worker-src"]) {
    assert.equal(directive(name), "", `${name} should no longer be granted`);
  }
});

test("csp: no wildcard origins", () => {
  assert.ok(!/(^|[\s;])\*(;|$)/.test(csp), csp);
  assert.ok(!csp.includes("http://*"));
  assert.ok(!csp.includes("https://*"));
});
