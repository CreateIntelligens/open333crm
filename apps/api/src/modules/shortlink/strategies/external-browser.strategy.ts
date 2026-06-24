/**
 * EXTERNAL_BROWSER strategy — a human in an ordinary browser. Return a micro
 * HTML page with the target URL inlined. The script fires a background
 * `navigator.sendBeacon` to `/s/track` (the only place a click is recorded),
 * then seamlessly `window.location.replace`s to the target (Zero-Click). The
 * GET response itself records nothing.
 */

import type { RedirectStrategy, RenderContext, RenderResult } from './types.js';
import { escapeHtmlAttr, jsonForScript, NO_STORE_HEADERS } from './render-utils.js';

export const externalBrowserStrategy: RedirectStrategy = {
  render(ctx: RenderContext): RenderResult {
    const { link, targetUrl, cid, trackPath } = ctx;

    const target = jsonForScript(targetUrl);
    const beaconBody = jsonForScript(JSON.stringify({ slug: link.slug, cid: cid ?? null }));
    const trackUrl = jsonForScript(trackPath);

    const html = `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="robots" content="noindex">
<meta name="referrer" content="no-referrer-when-downgrade">
<title>Redirecting…</title>
</head>
<body>
<script>
(function () {
  var target = ${target};
  try {
    var body = new Blob([${beaconBody}], { type: 'text/plain;charset=UTF-8' });
    navigator.sendBeacon(${trackUrl}, body);
  } catch (e) {}
  window.location.replace(target);
})();
</script>
<noscript><a href="${escapeHtmlAttr(targetUrl)}">繼續前往</a></noscript>
</body>
</html>`;

    return { status: 200, html, headers: NO_STORE_HEADERS };
  },
};
