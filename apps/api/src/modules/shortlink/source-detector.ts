/**
 * Short link source detection — classify the request User-Agent into a
 * SourceType so the redirect handler can pick the matching strategy.
 *
 * Matching order is significant: BOT must be checked BEFORE LINE_WEBVIEW,
 * because the LINE preview crawler and the LINE in-app human webview both
 * carry "LINE"-ish tokens, and misclassifying the human webview as a bot
 * would break the whole LINE/LIFF flow.
 */

export type SourceType = 'BOT' | 'EXTERNAL_BROWSER' | 'LINE_WEBVIEW' | 'FB_WEBVIEW';

/**
 * Social/preview crawlers that must NOT count as a click. Matched
 * case-insensitively as substrings of the User-Agent. Configurable — extend
 * this list as new crawlers appear.
 */
export const BOT_UA_PATTERNS: string[] = [
  'line-poker',
  'facebookexternalhit',
  'facebot',
  'twitterbot',
  'slackbot',
  'discordbot',
  'telegrambot',
  'whatsapp',
  'googlebot',
  'bingbot',
  'applebot',
  'skypeuripreview',
  'redditbot',
  'embedly',
];

/** LINE in-app webview (human) — e.g. "...; Line/13.5.0". */
const LINE_WEBVIEW_PATTERN = 'line/';

/** Facebook / Instagram / Messenger in-app webview (human). */
const FB_WEBVIEW_PATTERNS = ['fban', 'fbav', 'fb_iab', 'instagram'];

/**
 * Dev/testing override map for `?ua_simulator=` — lets you exercise each branch
 * from a normal browser without spoofing the User-Agent header. Pure mapping;
 * the route decides whether overrides are allowed (non-production only).
 */
const SOURCE_OVERRIDES: Record<string, SourceType> = {
  bot: 'BOT',
  line: 'LINE_WEBVIEW',
  line_webview: 'LINE_WEBVIEW',
  fb: 'FB_WEBVIEW',
  fb_webview: 'FB_WEBVIEW',
  external: 'EXTERNAL_BROWSER',
  external_browser: 'EXTERNAL_BROWSER',
};

export function parseSourceOverride(value?: string | null): SourceType | null {
  if (!value) return null;
  return SOURCE_OVERRIDES[value.toLowerCase()] ?? null;
}

export function detectSource(userAgent?: string | null): SourceType {
  if (!userAgent) return 'EXTERNAL_BROWSER';
  const ua = userAgent.toLowerCase();

  // 1. Bots first — most specific, must win over webview tokens.
  if (BOT_UA_PATTERNS.some((p) => ua.includes(p))) return 'BOT';

  // 2. LINE in-app webview (human).
  if (ua.includes(LINE_WEBVIEW_PATTERN)) return 'LINE_WEBVIEW';

  // 3. FB family in-app webview (human) — handled like external browser for now (Phase 2).
  if (FB_WEBVIEW_PATTERNS.some((p) => ua.includes(p))) return 'FB_WEBVIEW';

  // 4. Default: ordinary external browser.
  return 'EXTERNAL_BROWSER';
}
