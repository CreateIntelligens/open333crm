/**
 * LINE_WEBVIEW strategy — a human opened the link inside the LINE in-app
 * browser. When the link's bound LINE channel has a `liffId`, redirect into the
 * LIFF flow (`liff.line.me/{liffId}?s=&cid=&lid=`) so the LIFF page can collect
 * the lineUid. When there is no liffId (link not bound / channel not
 * configured), fall back to the plain external-browser zero-click behavior.
 */

import type { RedirectStrategy, RenderContext, RenderResult } from "./types.js";
import {
  escapeHtmlAttr,
  jsonForScript,
  NO_STORE_HEADERS,
} from "./render-utils.js";
import { externalBrowserStrategy } from "./external-browser.strategy.js";
import { buildTrackingSnippets } from "./tracking-snippet.js";

function buildLiffUrl(liffId: string, slug: string, cid?: string): string {
  const params = new URLSearchParams();
  params.set("s", slug);
  if (cid) params.set("cid", cid);
  params.set("lid", liffId);
  return `https://liff.line.me/${encodeURIComponent(liffId)}?${params.toString()}`;
}

export const lineWebviewStrategy: RedirectStrategy = {
  render(ctx: RenderContext): RenderResult {
    const { link, liffId, cid, gaId, metaPixelId } = ctx;

    // No LIFF configured for this link → behave like an external browser.
    if (!liffId) {
      return externalBrowserStrategy.render(ctx);
    }

    const liffUrl = buildLiffUrl(liffId, link.slug, cid);
    const trackingSnippets = buildTrackingSnippets(gaId, metaPixelId);

    const html = `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="robots" content="noindex">
<title>Redirecting…</title>
</head>
<body>
${trackingSnippets}
<script>
(function () { window.location.replace(${jsonForScript(liffUrl)}); })();
</script>
<noscript><a href="${escapeHtmlAttr(liffUrl)}">繼續前往</a></noscript>
</body>
</html>`;

    return { status: 200, html, headers: NO_STORE_HEADERS };
  },
};
