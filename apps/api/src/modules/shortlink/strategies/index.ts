import type { SourceType } from '../source-detector.js';
import type { RedirectStrategy, RenderResult } from './types.js';
import { botStrategy } from './bot.strategy.js';
import { externalBrowserStrategy } from './external-browser.strategy.js';
import { lineWebviewStrategy } from './line-webview.strategy.js';
import { NO_STORE_HEADERS } from './render-utils.js';

export * from './types.js';
export { botStrategy, externalBrowserStrategy, lineWebviewStrategy };

/**
 * Pick the redirect strategy for a detected source. FB_WEBVIEW is handled like
 * an external browser for now (its own strategy is Phase 2).
 */
export function getStrategy(source: SourceType): RedirectStrategy {
  switch (source) {
    case 'BOT':
      return botStrategy;
    case 'LINE_WEBVIEW':
      return lineWebviewStrategy;
    case 'FB_WEBVIEW':
    case 'EXTERNAL_BROWSER':
    default:
      return externalBrowserStrategy;
  }
}

/** Friendly page shown to a human when the link is missing/inactive/expired. */
export function renderExpiredPage(): RenderResult {
  const html = `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="robots" content="noindex">
<title>連結已失效</title>
<style>
  body { font-family: system-ui, -apple-system, "PingFang TC", "Microsoft JhengHei", sans-serif;
         display: flex; min-height: 90vh; align-items: center; justify-content: center;
         text-align: center; color: #334155; margin: 0; }
  .box { padding: 24px; }
  h1 { font-size: 20px; margin: 0 0 8px; }
  p { font-size: 14px; color: #64748b; margin: 0; }
</style>
</head>
<body>
<div class="box">
  <h1>連結已失效</h1>
  <p>此短連結不存在、已停用或已過期。</p>
</div>
</body>
</html>`;
  return { status: 404, html, headers: NO_STORE_HEADERS };
}
