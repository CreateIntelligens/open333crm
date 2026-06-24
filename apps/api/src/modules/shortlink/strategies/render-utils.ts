/**
 * Small helpers for safely embedding DB/user values into the HTML and inline
 * <script> bodies the redirect strategies return.
 */

/** Escape a string for use inside an HTML attribute value. */
export function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// U+2028 (line separator) and U+2029 (paragraph separator) are valid JSON but
// break JS string literals. Built from char codes so the source stays ASCII.
const JS_LINE_SEPARATORS = new RegExp(
  '[' + String.fromCharCode(0x2028) + String.fromCharCode(0x2029) + ']',
  'g',
);

/**
 * Serialize a value to a JS literal that is safe to inline inside a <script>
 * tag — JSON.stringify plus escaping of characters that could break out of the
 * script element or the JS string (`<`, `>`, `&`, U+2028, U+2029).
 */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value ?? null)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(JS_LINE_SEPARATORS, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}

export const NO_STORE_HEADERS: Record<string, string> = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store, no-cache, must-revalidate',
};
