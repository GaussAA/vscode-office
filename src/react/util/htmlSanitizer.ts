/**
 * HTML Sanitization utilities for preventing XSS attacks.
 *
 * Uses DOMPurify to safely parse and clean HTML from untrusted sources,
 * particularly clipboard content during spreadsheet paste operations.
 *
 * @module htmlSanitizer
 */

import DOMPurify from "dompurify";

/**
 * DOMPurify bound to the global `window`.
 *
 * This module is bundled into the webview, so it must not import `jsdom`: that drags undici
 * into the Excel bundle, and undici calls `util.channel` at load, which the browser polyfill
 * lacks (`r.channel is not a function`, the Excel viewer never mounts). Unit tests install a
 * jsdom `window` on `globalThis` before importing this module.
 */
const purify = DOMPurify(window);

/**
 * Sanitize HTML from clipboard to prevent XSS attacks.
 *
 * Only allows table-related tags and safe attributes needed for spreadsheet paste.
 * Removes all event handlers, scripts, and potentially dangerous content.
 *
 * @param html - Raw HTML from clipboard
 * @returns Sanitized HTML safe to insert into DOM
 */
export function sanitizeClipboardHTML(html: string): string {
  return purify.sanitize(html, {
    // Only allow tags needed for table parsing
    ALLOWED_TAGS: [
      "table",
      "thead",
      "tbody",
      "tfoot",
      "tr",
      "td",
      "th",
      "caption",
      "colgroup",
      "col",
      // Allow some formatting tags that might carry style info
      "b",
      "i",
      "u",
      "s",
      "strong",
      "em",
      "span",
      "div",
      "br",
    ],
    // Only allow safe attributes
    ALLOWED_ATTR: [
      "rowspan",
      "colspan",
      "style", // CSS styles (DOMPurify sanitizes style values)
      "class", // CSS classes
      "width",
      "height",
      "align",
      "valign",
      "bgcolor",
      "border",
      "cellpadding",
      "cellspacing",
    ],
    // Additional security options
    KEEP_CONTENT: true, // Keep text content even if tags are removed
    ALLOW_DATA_ATTR: false, // No data-* attributes
    ALLOW_UNKNOWN_PROTOCOLS: false, // Only allow http/https/mailto etc
    SAFE_FOR_TEMPLATES: true, // Extra safety for template contexts
  });
}

/**
 * Sanitize HTML for tooltip display.
 *
 * More restrictive than clipboard sanitization - only allows basic formatting.
 *
 * @param html - Raw HTML for tooltip
 * @returns Sanitized HTML
 */
export function sanitizeTooltipHTML(html: string): string {
  return purify.sanitize(html, {
    ALLOWED_TAGS: ["b", "i", "u", "strong", "em", "br", "span", "div"],
    ALLOWED_ATTR: ["class", "style"],
    KEEP_CONTENT: true,
    ALLOW_DATA_ATTR: false,
    ALLOW_UNKNOWN_PROTOCOLS: false,
  });
}
