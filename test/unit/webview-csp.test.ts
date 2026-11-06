import assert from "node:assert/strict";
import test from "node:test";
import { buildWebviewCsp } from "@/common/webviewCsp";

/**
 * Every webview renders under this policy. It is asserted here rather than only exercised in a
 * browser because the failure mode is silent: a rule that blocks a stylesheet or a frame leaves
 * the page looking fine in a screenshot. `verify:ui` additionally fails a run on any CSP
 * violation it observes, which is what proves the policy is compatible with all eight viewers.
 */

const ORIGIN = "vscode-webview://abc";
const csp = buildWebviewCsp(ORIGIN);
const directive = (name) => csp.split("; ").find((part) => part.startsWith(`${name} `)) ?? "";

test("csp: denies by default", () => {
  assert.ok(csp.startsWith(`default-src 'none'`), csp);
});

test("csp: every resource class a viewer needs is spelled out for the webview origin", () => {
  for (const name of [
    "script-src",
    "style-src",
    "img-src",
    "font-src",
    "media-src",
    "frame-src",
    "connect-src",
    "worker-src",
  ]) {
    assert.ok(
      directive(name).includes(ORIGIN),
      `${name} does not allow the webview origin: ${directive(name)}`,
    );
  }
});

test("csp: inline styles are allowed for antd, inline scripts are not", () => {
  // antd is CSS-in-JS and injects <style> at runtime; removing this breaks every viewer.
  assert.ok(directive("style-src").includes(`'unsafe-inline'`));
  const scriptSrc = directive("script-src");
  assert.ok(!scriptSrc.includes(`'unsafe-inline'`), "inline scripts must stay blocked");
  assert.ok(!scriptSrc.includes(`'unsafe-eval'`), "eval must stay blocked");
});

test("csp: the font viewer keeps wasm compilation", () => {
  // Its woff2 decompressor is an Emscripten module; without this the font route cannot decode.
  assert.ok(directive("script-src").includes(`'wasm-unsafe-eval'`));
});

test("csp: no wildcard origins", () => {
  assert.ok(!/(^|[\s;])\*(;|$)/.test(csp), csp);
  assert.ok(!csp.includes("http://*"));
  assert.ok(!csp.includes("https://*"));
});
