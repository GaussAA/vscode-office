/**
 * HTML Sanitization utilities for preventing XSS attacks.
 *
 * Uses DOMPurify to safely parse and clean HTML from untrusted sources,
 * particularly clipboard content during spreadsheet paste operations.
 *
 * @module htmlSanitizer
 */

import DOMPurify from "dompurify";
import { JSDOM } from "jsdom";

/**
 * Create a DOMPurify instance that works in both browser and Node.js environments.
 *
 * In the browser, uses the window object directly.
 * In Node.js (for testing), creates a JSDOM window.
 *
 * @returns DOMPurify instance configured for the current environment
 */
const createDOMPurify = () => {
  if (typeof window !== "undefined") {
    // Browser environment
    return DOMPurify(window);
  } else {
    // Node.js environment - create a JSDOM window
    const jsdomWindow = new JSDOM("").window;
    return DOMPurify(jsdomWindow as unknown as Window & typeof globalThis);
  }
};

const purify = createDOMPurify();

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
