import assert from "node:assert/strict";
import test from "node:test";
import { normalizeExternalUrl } from "@/common/externalLink";

test("externalLink: accepts absolute http(s) URLs", () => {
  assert.equal(
    normalizeExternalUrl("https://huggingface.co/datasets/foo"),
    "https://huggingface.co/datasets/foo",
  );
  assert.equal(normalizeExternalUrl("  http://example.com/a  "), "http://example.com/a");
  assert.equal(normalizeExternalUrl("HTTPS://example.com/a"), "https://example.com/a");
  assert.equal(normalizeExternalUrl("https://example.com/a b"), "https://example.com/a%20b");
});

test("externalLink: rejects schemes that can execute or touch local resources", () => {
  for (const value of [
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "file:///C:/Windows/win.ini",
    "vscode://settings",
    "command:workbench.action.terminal.new",
    "ftp://example.com/file",
    "mailto:someone@example.com",
    "//example.com/no-scheme",
    "example.com/no-scheme",
  ]) {
    assert.equal(normalizeExternalUrl(value), null, value);
  }
});

test("externalLink: rejects credentials, control characters, blanks and oversized values", () => {
  assert.equal(normalizeExternalUrl("https://user:pass@example.com/"), null);
  assert.equal(normalizeExternalUrl("https://user@example.com/"), null);
  assert.equal(normalizeExternalUrl("https://example.com/\nnext"), null);
  assert.equal(normalizeExternalUrl(" \t "), null);
  assert.equal(normalizeExternalUrl(`https://example.com/${"a".repeat(2_100)}`), null);
  assert.equal(normalizeExternalUrl(null), null);
  assert.equal(normalizeExternalUrl(42), null);
});
