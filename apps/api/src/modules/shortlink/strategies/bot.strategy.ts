/**
 * BOT strategy — a social/preview crawler hit the short link. Return a static
 * HTML document carrying only Open Graph meta tags so the chat preview card
 * renders. NEVER call the tracking endpoint or write to the DB here (no fake
 * clicks). OG values come from the stored snapshot, falling back to `title`.
 */

import type { RedirectStrategy, RenderContext, RenderResult } from './types.js';
import { escapeHtmlAttr, NO_STORE_HEADERS } from './render-utils.js';

export const botStrategy: RedirectStrategy = {
  render(ctx: RenderContext): RenderResult {
    const { link } = ctx;
    const title = link.ogTitle || link.title || '';
    const description = link.ogDescription || '';
    const image = link.ogImage || '';

    const tags: string[] = [
      `<meta property="og:type" content="website">`,
      title ? `<meta property="og:title" content="${escapeHtmlAttr(title)}">` : '',
      description ? `<meta property="og:description" content="${escapeHtmlAttr(description)}">` : '',
      image ? `<meta property="og:image" content="${escapeHtmlAttr(image)}">` : '',
    ].filter(Boolean);

    const html = `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="robots" content="noindex">
${tags.join('\n')}
<title>${escapeHtmlAttr(title)}</title>
</head>
<body></body>
</html>`;

    return { status: 200, html, headers: NO_STORE_HEADERS };
  },
};
