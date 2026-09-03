import { isIP } from 'node:net';

export const TWO_MD_BASE_URLS = [
  'https://2md.aiurl.tw',
  'https://2md.glsoft.ai',
  'https://create360.ai',
] as const;

export const WEB_CONTENT_LIMIT = 30_000;
export const WEB_REQUEST_TIMEOUT_MS = 15_000;

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface BoundedText {
  text: string;
  truncated: boolean;
}

export function assertSafePublicHttpUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('Invalid URL');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only HTTP(S) URL is supported');
  }
  if (url.username || url.password) {
    throw new Error('URL credentials are not allowed');
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (isUnsafeHostname(hostname)) {
    throw new Error(`Rejected unsafe URL target: ${hostname}`);
  }

  return url;
}

function isUnsafeHostname(hostname: string): boolean {
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    return true;
  }

  const ipVersion = isIP(hostname);
  if (ipVersion === 4) {
    const octets = hostname.split('.').map(Number);
    const [a, b] = octets;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (ipVersion === 6) {
    if (hostname.startsWith('::ffff:')) {
      const mappedPart = hostname.slice('::ffff:'.length);
      const mappedIpv4 = mappedPart.includes('.')
        ? mappedPart
        : (() => {
          const segments = mappedPart.split(':');
          if (segments.length !== 2 || segments.some((segment) => !/^[0-9a-f]{1,4}$/i.test(segment))) return '';
          const high = Number.parseInt(segments[0], 16);
          const low = Number.parseInt(segments[1], 16);
          return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
        })();
      return isIP(mappedIpv4) === 4 && isUnsafeHostname(mappedIpv4);
    }
    return (
      hostname === '::1' ||
      hostname === '::' ||
      hostname.startsWith('fc') ||
      hostname.startsWith('fd') ||
      hostname.startsWith('fe8') ||
      hostname.startsWith('fe9') ||
      hostname.startsWith('fea') ||
      hostname.startsWith('feb') ||
      hostname.startsWith('ff')
    );
  }
  return false;
}

export function build2mdRequestUrl(baseUrl: string, path = ''): string {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return path ? `${base}${path.replace(/^\//, '')}` : base;
}

export async function readBoundedText(
  body: ReadableStream<Uint8Array> | null,
  limit: number,
): Promise<BoundedText> {
  if (!body) return { text: '', truncated: false };
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let truncated = false;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) {
        text += decoder.decode();
        break;
      }
      text += decoder.decode(next.value, { stream: true });
      if (text.length >= limit) {
        text = text.slice(0, limit);
        truncated = true;
        await reader.cancel();
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }
  return { text, truncated };
}

async function fetchText(
  url: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
): Promise<{ text: string; truncated: boolean }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WEB_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal, redirect: 'manual' });
    if (!response.ok) throw new Error(`upstream responded ${response.status}`);
    return await readBoundedText(response.body, WEB_CONTENT_LIMIT);
  } finally {
    clearTimeout(timeout);
  }
}

function decodeResponse(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

function responseItems(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  const obj = payload as Record<string, unknown>;
  if (Array.isArray(obj.data)) return obj.data;
  if (Array.isArray(obj.results)) return obj.results;
  if (obj.data && typeof obj.data === 'object') return [obj.data];
  return [];
}

export function normalizeSearchResponse(payload: unknown): SearchResult[] {
  const items = responseItems(payload);
  const structured = items.flatMap((item): SearchResult[] => {
    if (!item || typeof item !== 'object') return [];
    const row = item as Record<string, unknown>;
    const rawUrl = row.url ?? row.link;
    if (typeof rawUrl !== 'string') return [];
    let url: URL;
    try {
      url = assertSafePublicHttpUrl(rawUrl);
    } catch {
      return [];
    }
    const title = typeof row.title === 'string' && row.title.trim() ? row.title.trim() : url.hostname;
    const snippetValue = row.snippet ?? row.content ?? row.description ?? '';
    const snippet = typeof snippetValue === 'string' ? snippetValue.trim().slice(0, 2_000) : '';
    return [{ title: title.slice(0, 300), url: url.toString(), snippet }];
  });
  if (structured.length > 0) return structured.slice(0, 10);

  if (typeof payload !== 'string') return [];
  const matches = [...payload.matchAll(/\[([^\]]{1,300})\]\((https?:\/\/[^)\s]+)\)/g)];
  return matches.slice(0, 10).flatMap((match, index): SearchResult[] => {
    try {
      const url = assertSafePublicHttpUrl(match[2]);
      const start = match.index ?? 0;
      const afterLink = payload.slice(start + match[0].length).replace(/^\s*\n/, '');
      const lineEnd = afterLink.indexOf('\n');
      const snippet = (lineEnd < 0 ? afterLink : afterLink.slice(0, lineEnd)).trim();
      return [{ title: match[1].trim(), url: url.toString(), snippet: snippet.slice(0, 2_000) || `Search result ${index + 1}` }];
    } catch {
      return [];
    }
  });
}

export async function readThrough2md(
  targetUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ content: string; source: string; truncated: boolean }> {
  const safeUrl = assertSafePublicHttpUrl(targetUrl).toString();
  let lastError: unknown;
  for (const base of TWO_MD_BASE_URLS) {
    try {
      const response = await fetchText(build2mdRequestUrl(base), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Preset': 'agent' },
        body: JSON.stringify({ url: safeUrl }),
      }, fetchImpl);
      const payload = decodeResponse(response.text);
      const extracted = extractReadableContent(payload);
      if (!extracted && typeof payload !== 'string') throw new Error('invalid reader response');
      const content = extracted || response.text;
      if (content.trim()) return { content: content.slice(0, WEB_CONTENT_LIMIT), source: base, truncated: response.truncated || content.length > WEB_CONTENT_LIMIT };
      throw new Error('empty reader response');
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`All web reader services failed: ${lastError instanceof Error ? lastError.message : 'unknown error'}`);
}

function extractReadableContent(payload: unknown): string {
  if (typeof payload === 'string') return payload;
  if (!payload || typeof payload !== 'object') return '';
  const obj = payload as Record<string, unknown>;
  if (typeof obj.content === 'string') return obj.content;
  if (typeof obj.markdown === 'string') return obj.markdown;
  const first = responseItems(payload)[0];
  if (first && typeof first === 'object') {
    const row = first as Record<string, unknown>;
    for (const key of ['content', 'markdown', 'text']) if (typeof row[key] === 'string') return row[key] as string;
  }
  return '';
}

export async function searchThrough2md(
  query: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ results: SearchResult[]; source: string }> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery || normalizedQuery.length > 500) throw new Error('Search query must be 1-500 characters');
  let lastError: unknown;
  for (const base of TWO_MD_BASE_URLS) {
    try {
      const path = `search?q=${encodeURIComponent(normalizedQuery)}`;
      const response = await fetchText(build2mdRequestUrl(base, path), { headers: { Accept: 'application/json', 'X-Preset': 'agent' } }, fetchImpl);
      const results = normalizeSearchResponse(decodeResponse(response.text));
      if (results.length > 0) return { results, source: base };
      throw new Error('empty search response');
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`All web search services failed: ${lastError instanceof Error ? lastError.message : 'unknown error'}`);
}
