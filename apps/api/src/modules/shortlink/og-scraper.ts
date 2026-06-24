/**
 * Open Graph snapshot scraper. Fetches a target URL and extracts og:title /
 * og:description / og:image so the bot preview can render without a live crawl
 * of the target at request time.
 *
 * Guards: http/https only, DNS resolved + private/loopback IPs blocked (SSRF),
 * request timeout, response-size cap, HTML content-type only. Any failure
 * returns an empty object — scraping must never block link create/update.
 */

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { logger } from '@open333crm/core';

const TIMEOUT_MS = 5000;
const MAX_BYTES = 512 * 1024; // 512 KB is plenty for <head>
const MAX_REDIRECTS = 5;

export interface OgSnapshot {
  ogTitle?: string;
  ogDescription?: string;
  ogImage?: string;
}

function isPrivateIp(ip: string): boolean {
  if (isIP(ip) === 4) {
    const p = ip.split('.').map(Number);
    if (p[0] === 0 || p[0] === 10 || p[0] === 127) return true;
    if (p[0] === 169 && p[1] === 254) return true; // link-local
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    if (p[0] === 192 && p[1] === 168) return true;
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true; // CGNAT
    return false;
  }
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true;
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique local
  if (lower.startsWith('fe80')) return true; // link-local
  if (lower.startsWith('::ffff:')) {
    const v4 = lower.slice(7);
    if (isIP(v4) === 4) return isPrivateIp(v4);
  }
  return false;
}

async function hostIsBlocked(hostname: string): Promise<boolean> {
  if (isIP(hostname)) return isPrivateIp(hostname);
  try {
    const { address } = await lookup(hostname);
    return isPrivateIp(address);
  } catch {
    return true; // can't resolve → refuse
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/gi, "'");
}

function extractMeta(html: string, property: string): string | undefined {
  const esc = property.replace(/[:]/g, '\\$&');
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${esc}["'][^>]*content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${esc}["']`, 'i'),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) return decodeEntities(m[1]).trim();
  }
  return undefined;
}

async function readCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder('utf-8');
  let received = 0;
  let out = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    out += decoder.decode(value, { stream: true });
    if (received >= MAX_BYTES) {
      await reader.cancel().catch(() => {});
      break;
    }
  }
  return out;
}

/**
 * Fetch following redirects manually so the SSRF guard runs on EVERY hop — a
 * 302 to 127.0.0.1 / 169.254.* / RFC1918 / etc. is re-validated and refused,
 * instead of being silently followed by `redirect: 'follow'`.
 */
async function safeFetch(start: URL, signal: AbortSignal): Promise<Response | null> {
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (await hostIsBlocked(url.hostname)) return null;

    const res = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      signal,
      headers: {
        'User-Agent': 'facebookexternalhit/1.1 (Open333CRM link preview)',
        Accept: 'text/html,application/xhtml+xml',
      },
    });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) return res;
      await res.body?.cancel().catch(() => {});
      let next: URL;
      try {
        next = new URL(location, url);
      } catch {
        return null;
      }
      url = next; // re-validated at the top of the next iteration
      continue;
    }
    return res;
  }
  return null; // too many redirects
}

export async function scrapeOg(targetUrl: string): Promise<OgSnapshot> {
  let url: URL;
  try {
    url = new URL(targetUrl);
  } catch {
    return {};
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await safeFetch(url, controller.signal);
    if (!res || !res.ok) return {};
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('html')) return {};

    const html = await readCapped(res);
    const ogTitle = extractMeta(html, 'og:title');
    const ogDescription = extractMeta(html, 'og:description') ?? extractMeta(html, 'description');
    let ogImage = extractMeta(html, 'og:image');
    if (ogImage) {
      try {
        ogImage = new URL(ogImage, res.url || url.toString()).toString();
      } catch {
        ogImage = undefined;
      }
    }
    return { ogTitle, ogDescription, ogImage };
  } catch (err) {
    logger.warn('[ShortLink] OG scrape failed:', (err as Error).message);
    return {};
  } finally {
    clearTimeout(timer);
  }
}
