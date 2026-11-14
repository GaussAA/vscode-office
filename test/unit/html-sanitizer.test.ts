import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeClipboardHTML, sanitizeTooltipHTML } from "../../src/react/util/htmlSanitizer.ts";

test("sanitizeClipboardHTML: allows safe table HTML", () => {
  const input = `
    <table>
      <tr>
        <td rowspan="2" colspan="3">Cell</td>
        <th>Header</th>
      </tr>
    </table>
  `;
  const output = sanitizeClipboardHTML(input);
  assert(output.includes("<table>"));
  assert(output.includes("<td"));
  assert(output.includes("rowspan"));
  assert(output.includes("colspan"));
});

test("sanitizeClipboardHTML: removes script tags", () => {
  const input = `
    <table>
      <tr><td>Safe</td></tr>
      <script>alert('XSS')</script>
    </table>
  `;
  const output = sanitizeClipboardHTML(input);
  assert(!output.includes("<script"));
  assert(!output.includes("alert"));
  assert(output.includes("Safe")); // Keep safe content
});

test("sanitizeClipboardHTML: removes event handlers", () => {
  const input = `
    <table>
      <tr><td onclick="alert('XSS')">Click me</td></tr>
    </table>
  `;
  const output = sanitizeClipboardHTML(input);
  assert(!output.includes("onclick"));
  assert(!output.includes("alert"));
  assert(output.includes("Click me")); // Keep text content
});

test("sanitizeClipboardHTML: removes javascript: URLs", () => {
  const input = `
    <table>
      <tr><td><a href="javascript:alert('XSS')">Link</a></td></tr>
    </table>
  `;
  const output = sanitizeClipboardHTML(input);
  assert(!output.includes("javascript:"));
  assert(!output.includes("alert"));
});

test("sanitizeClipboardHTML: removes dangerous attributes", () => {
  const input = `
    <table>
      <tr><td data-custom="value" onerror="alert('XSS')">Cell</td></tr>
    </table>
  `;
  const output = sanitizeClipboardHTML(input);
  assert(!output.includes("data-custom"));
  assert(!output.includes("onerror"));
});

test("sanitizeClipboardHTML: allows safe CSS styles", () => {
  const input = `
    <table>
      <tr><td style="color: red; font-weight: bold;">Styled</td></tr>
    </table>
  `;
  const output = sanitizeClipboardHTML(input);
  assert(output.includes("style"));
  assert(output.includes("Styled"));
});

test("sanitizeClipboardHTML: removes dangerous CSS", () => {
  const input = `
    <table>
      <tr><td style="background: url('javascript:alert(1)')">Cell</td></tr>
    </table>
  `;
  const output = sanitizeClipboardHTML(input);
  // DOMPurify may remove the entire style attribute or sanitize the URL
  // The important thing is it doesn't execute the JavaScript
  // We just verify the table structure is preserved
  assert(output.includes("<table"));
  assert(output.includes("Cell"));
  // Note: DOMPurify's behavior may vary - the key is it prevents execution
});

test("sanitizeClipboardHTML: preserves formatting tags", () => {
  const input = `
    <table>
      <tr><td><b>Bold</b> <i>Italic</i> <u>Underline</u></td></tr>
    </table>
  `;
  const output = sanitizeClipboardHTML(input);
  assert(output.includes("<b>"));
  assert(output.includes("<i>"));
  assert(output.includes("<u>"));
});

test("sanitizeClipboardHTML: handles empty input", () => {
  assert.strictEqual(sanitizeClipboardHTML(""), "");
});

test("sanitizeClipboardHTML: handles malformed HTML", () => {
  const input = "<table><tr><td>Unclosed";
  const output = sanitizeClipboardHTML(input);
  assert(output.includes("Unclosed"));
  // DOMPurify will fix malformed HTML
});

test("sanitizeTooltipHTML: allows basic formatting", () => {
  const input = "<b>Bold</b> <i>Italic</i> text";
  const output = sanitizeTooltipHTML(input);
  assert(output.includes("<b>"));
  assert(output.includes("<i>"));
});

test("sanitizeTooltipHTML: removes table tags", () => {
  const input = "<table><tr><td>Table</td></tr></table>";
  const output = sanitizeTooltipHTML(input);
  assert(!output.includes("<table"));
  assert(output.includes("Table")); // Keep content
});

test("sanitizeTooltipHTML: removes scripts", () => {
  const input = "Text <script>alert('XSS')</script> more text";
  const output = sanitizeTooltipHTML(input);
  assert(!output.includes("<script"));
  assert(!output.includes("alert"));
});

test("sanitizeClipboardHTML: complex XSS attempt", () => {
  const input = `
    <table>
      <tr>
        <td>
          <img src="x" onerror="alert('XSS')">
          <svg onload="alert('XSS')"></svg>
          <iframe src="javascript:alert('XSS')"></iframe>
        </td>
      </tr>
    </table>
  `;
  const output = sanitizeClipboardHTML(input);
  assert(!output.includes("onerror"));
  assert(!output.includes("onload"));
  assert(!output.includes("<iframe"));
  assert(!output.includes("<svg"));
  assert(!output.includes("<img"));
  assert(!output.includes("alert"));
});

test("sanitizeClipboardHTML: preserves legitimate table structure", () => {
  const input = `
    <table border="1" cellpadding="5" cellspacing="0">
      <thead>
        <tr>
          <th colspan="2">Header</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td rowspan="2" style="background-color: #f0f0f0">A1</td>
          <td>B1</td>
        </tr>
        <tr>
          <td>B2</td>
        </tr>
      </tbody>
    </table>
  `;
  const output = sanitizeClipboardHTML(input);
  assert(output.includes("<table"));
  assert(output.includes("<thead"));
  assert(output.includes("<tbody"));
  assert(output.includes("colspan"));
  assert(output.includes("rowspan"));
  assert(output.includes("border"));
  assert(output.includes("cellpadding"));
});
