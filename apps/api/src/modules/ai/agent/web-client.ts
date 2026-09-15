import { isIP } from 'node:net';
import { createHash } from 'node:crypto';

export const TWO_MD_BASE_URLS = [
  'https://2md.aiurl.tw',
  'https://2md.glsoft.ai',
  'https://create360.ai',
] as const;

export const WEB_CONTENT_LIMIT = 30_000;
export const WEB_REQUEST_TIMEOUT_MS = 15_000;
export const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_DOCUMENT_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface BoundedText {
  text: string;
  truncated: boolean;
}

export interface GroundingContentResult {
  content: string;
  source: string;
  truncated: boolean;
}

/**
 * Single-flight manager to coalesce identical in-flight promises,
 * preventing thundering herds against upstream services.
 */
export class SingleFlightManager {
  private inFlight = new Map<string, Promise<unknown>>();

  async do<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key);
    if (existing) {
      return existing as Promise<T>;
    }
    const promise = (async () => {
      try {
        return await fn();
      } finally {
        this.inFlight.delete(key);
      }
    })();
    this.inFlight.set(key, promise);
    return promise;
  }

  get inFlightCount(): number {
    return this.inFlight.size;
  }

  clear(): void {
    this.inFlight.clear();
  }
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/**
 * Bounded in-memory response cache with TTL and LRU-style eviction.
 */
export class BoundedMemoryCache<T> {
  private entries = new Map<string, CacheEntry<T>>();

  constructor(private maxEntries = 1000) {}

  get(key: string, now = Date.now()): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (now > entry.expiresAt) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T, ttlMs: number, now = Date.now()): void {
    if (this.entries.size >= this.maxEntries) {
      for (const [k, e] of this.entries) {
        if (now > e.expiresAt) {
          this.entries.delete(k);
        }
      }
      if (this.entries.size >= this.maxEntries) {
        const firstKey = this.entries.keys().next().value;
        if (firstKey) this.entries.delete(firstKey);
      }
    }
    this.entries.set(key, { value, expiresAt: now + ttlMs });
  }

  has(key: string, now = Date.now()): boolean {
    return this.get(key, now) !== undefined;
  }

  get size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }
}

export interface NodeHealthConfig {
  maxFailures?: number;
  cooldownMs?: number;
}

interface NodeState {
  consecutiveFailures: number;
  cooldownUntil: number;
}

/**
 * Circuit breaker and node health tracker for upstream multi-node pools.
 */
export class NodeHealthTracker {
  private nodes = new Map<string, NodeState>();
  private maxFailures: number;
  private cooldownMs: number;

  constructor(config: NodeHealthConfig = {}) {
    this.maxFailures = config.maxFailures ?? 3;
    this.cooldownMs = config.cooldownMs ?? 30_000;
  }

  recordSuccess(baseUrl: string): void {
    const state = this.nodes.get(baseUrl);
    if (state) {
      state.consecutiveFailures = 0;
      state.cooldownUntil = 0;
    }
  }

  recordFailure(baseUrl: string, now = Date.now()): void {
    let state = this.nodes.get(baseUrl);
    if (!state) {
      state = { consecutiveFailures: 0, cooldownUntil: 0 };
      this.nodes.set(baseUrl, state);
    }
    state.consecutiveFailures += 1;
    if (state.consecutiveFailures >= this.maxFailures) {
      state.cooldownUntil = now + this.cooldownMs;
    }
  }

  isAvailable(baseUrl: string, now = Date.now()): boolean {
    const state = this.nodes.get(baseUrl);
    if (!state) return true;
    if (state.cooldownUntil === 0) return true;
    return now >= state.cooldownUntil;
  }

  getPrioritizedNodes(baseUrls: readonly string[], now = Date.now()): string[] {
    const available: string[] = [];
    const cooling: string[] = [];
    for (const url of baseUrls) {
      if (this.isAvailable(url, now)) {
        available.push(url);
      } else {
        cooling.push(url);
      }
    }
    if (available.length === 0) {
      return [...baseUrls].sort((a, b) => {
        const aUntil = this.nodes.get(a)?.cooldownUntil ?? 0;
        const bUntil = this.nodes.get(b)?.cooldownUntil ?? 0;
        return aUntil - bUntil;
      });
    }
    return available;
  }

  reset(): void {
    this.nodes.clear();
  }
}

export function calculateJitterDelay(minMs = 20, maxMs = 80): number {
  return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Singletons for process-wide request coalescing and health tracking
export const globalSingleFlight = new SingleFlightManager();
export const globalNodeHealthTracker = new NodeHealthTracker();

export const searchCache = new BoundedMemoryCache<{ results: SearchResult[]; source: string }>(1000);
export const readerCache = new BoundedMemoryCache<GroundingContentResult>(1000);
export const ocrCache = new BoundedMemoryCache<GroundingContentResult>(1000);
export const docCache = new BoundedMemoryCache<GroundingContentResult>(1000);

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

function extractReadableContent(payload: unknown): string {
  if (typeof payload === 'string') return payload;
  if (!payload || typeof payload !== 'object') return '';
  const obj = payload as Record<string, unknown>;
  if (typeof obj.content === 'string') return obj.content;
  if (typeof obj.markdown === 'string') return obj.markdown;
  if (typeof obj.text === 'string') return obj.text;
  const first = responseItems(payload)[0];
  if (first && typeof first === 'object') {
    const row = first as Record<string, unknown>;
    for (const key of ['content', 'markdown', 'text']) {
      if (typeof row[key] === 'string') return row[key] as string;
    }
  }
  return '';
}

/**
 * Reads a web page through 2md with single-flight deduplication, short-lived cache,
 * and circuit-breaker failover across TWO_MD_BASE_URLS.
 */
export async function readThrough2md(
  targetUrl: string,
  fetchImpl: typeof fetch = fetch,
  options: {
    baseUrls?: readonly string[];
    skipCache?: boolean;
    singleFlight?: SingleFlightManager;
    healthTracker?: NodeHealthTracker;
  } = {},
): Promise<GroundingContentResult> {
  const safeUrl = assertSafePublicHttpUrl(targetUrl).toString();
  const cacheKey = `read:${safeUrl}`;

  if (!options.skipCache) {
    const cached = readerCache.get(cacheKey);
    if (cached) return cached;
  }

  const sf = options.singleFlight ?? globalSingleFlight;
  return sf.do(cacheKey, async () => {
    if (!options.skipCache) {
      const cached = readerCache.get(cacheKey);
      if (cached) return cached;
    }

    const health = options.healthTracker ?? globalNodeHealthTracker;
    const baseList = options.baseUrls ?? TWO_MD_BASE_URLS;
    const prioritized = health.getPrioritizedNodes(baseList);

    let lastError: unknown;
    for (let i = 0; i < prioritized.length; i++) {
      const base = prioritized[i];
      if (i > 0) {
        await delay(calculateJitterDelay());
      }
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
        if (!content.trim()) throw new Error('empty reader response');

        const result: GroundingContentResult = {
          content: content.slice(0, WEB_CONTENT_LIMIT),
          source: base,
          truncated: response.truncated || content.length > WEB_CONTENT_LIMIT,
        };

        health.recordSuccess(base);
        readerCache.set(cacheKey, result, 60_000);
        return result;
      } catch (error) {
        health.recordFailure(base);
        lastError = error;
      }
    }
    throw new Error(`All web reader services failed: ${lastError instanceof Error ? lastError.message : 'unknown error'}`);
  });
}

/**
 * Searches the web through 2md with single-flight deduplication, short-lived cache,
 * and circuit-breaker failover across TWO_MD_BASE_URLS.
 */
export async function searchThrough2md(
  query: string,
  fetchImpl: typeof fetch = fetch,
  options: {
    baseUrls?: readonly string[];
    skipCache?: boolean;
    singleFlight?: SingleFlightManager;
    healthTracker?: NodeHealthTracker;
  } = {},
): Promise<{ results: SearchResult[]; source: string }> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery || normalizedQuery.length > 500) {
    throw new Error('Search query must be 1-500 characters');
  }
  const cacheKey = `search:${normalizedQuery}`;

  if (!options.skipCache) {
    const cached = searchCache.get(cacheKey);
    if (cached) return cached;
  }

  const sf = options.singleFlight ?? globalSingleFlight;
  return sf.do(cacheKey, async () => {
    if (!options.skipCache) {
      const cached = searchCache.get(cacheKey);
      if (cached) return cached;
    }

    const health = options.healthTracker ?? globalNodeHealthTracker;
    const baseList = options.baseUrls ?? TWO_MD_BASE_URLS;
    const prioritized = health.getPrioritizedNodes(baseList);

    let lastError: unknown;
    for (let i = 0; i < prioritized.length; i++) {
      const base = prioritized[i];
      if (i > 0) {
        await delay(calculateJitterDelay());
      }
      try {
        const path = `search?q=${encodeURIComponent(normalizedQuery)}`;
        const response = await fetchText(build2mdRequestUrl(base, path), {
          headers: { Accept: 'application/json', 'X-Preset': 'agent' },
        }, fetchImpl);

        const results = normalizeSearchResponse(decodeResponse(response.text));
        if (results.length === 0) throw new Error('empty search response');

        const result = { results, source: base };
        health.recordSuccess(base);
        searchCache.set(cacheKey, result, 60_000);
        return result;
      } catch (error) {
        health.recordFailure(base);
        lastError = error;
      }
    }
    throw new Error(`All web search services failed: ${lastError instanceof Error ? lastError.message : 'unknown error'}`);
  });
}

/**
 * Converts image files (screenshots, receipts, invoices) to Markdown text via 2md PP-OCRv4 engine
 * with single-flight coalescing and circuit-breaker failover.
 */
export async function ocrThrough2md(
  imageInput: string | Buffer | Uint8Array,
  fetchImpl: typeof fetch = fetch,
  options: {
    baseUrls?: readonly string[];
    filename?: string;
    skipCache?: boolean;
    singleFlight?: SingleFlightManager;
    healthTracker?: NodeHealthTracker;
  } = {},
): Promise<GroundingContentResult> {
  const isUrl = typeof imageInput === 'string' && (imageInput.startsWith('http://') || imageInput.startsWith('https://'));
  let safeUrl = '';
  let bufferHash = '';
  let imageBuffer: Buffer | null = null;

  if (isUrl) {
    safeUrl = assertSafePublicHttpUrl(imageInput as string).toString();
  } else {
    imageBuffer = typeof imageInput === 'string' ? Buffer.from(imageInput, 'base64') : Buffer.from(imageInput);
    if (imageBuffer.byteLength > MAX_IMAGE_SIZE_BYTES) {
      throw new Error(`Image size exceeds limit of ${MAX_IMAGE_SIZE_BYTES / (1024 * 1024)} MB`);
    }
    bufferHash = createHash('sha256').update(imageBuffer).digest('hex');
  }

  const cacheKey = `ocr:${isUrl ? safeUrl : bufferHash}`;
  if (!options.skipCache) {
    const cached = ocrCache.get(cacheKey);
    if (cached) return cached;
  }

  const sf = options.singleFlight ?? globalSingleFlight;
  return sf.do(cacheKey, async () => {
    if (!options.skipCache) {
      const cached = ocrCache.get(cacheKey);
      if (cached) return cached;
    }

    if (isUrl && !imageBuffer) {
      const imgRes = await fetchImpl(safeUrl);
      if (!imgRes.ok) throw new Error(`Failed to fetch image from URL: ${imgRes.status}`);
      const arrayBuf = await imgRes.arrayBuffer();
      if (arrayBuf.byteLength > MAX_IMAGE_SIZE_BYTES) {
        throw new Error(`Image size exceeds limit of ${MAX_IMAGE_SIZE_BYTES / (1024 * 1024)} MB`);
      }
      imageBuffer = Buffer.from(arrayBuf);
    }

    const health = options.healthTracker ?? globalNodeHealthTracker;
    const baseList = options.baseUrls ?? TWO_MD_BASE_URLS;
    const prioritized = health.getPrioritizedNodes(baseList);

    let lastError: unknown;
    for (let i = 0; i < prioritized.length; i++) {
      const base = prioritized[i];
      if (i > 0) {
        await delay(calculateJitterDelay());
      }
      try {
        const ocrUrl = build2mdRequestUrl(base, 'api/ocr');
        const buf = imageBuffer!;
        const formData = new FormData();
        const filename = options.filename || (isUrl ? safeUrl.split('/').pop()?.split('?')[0] || 'image.png' : 'image.png');
        formData.append('file', new Blob([buf]), filename);
        const requestInit: RequestInit = {
          method: 'POST',
          headers: { Accept: 'application/json', 'X-Preset': 'agent' },
          body: formData,
        };

        const response = await fetchText(ocrUrl, requestInit, fetchImpl);
        const payload = decodeResponse(response.text);
        const extracted = extractReadableContent(payload);
        if (!extracted && typeof payload !== 'string') throw new Error('invalid ocr response');
        const content = extracted || response.text;
        if (!content.trim()) throw new Error('empty ocr response');

        const result: GroundingContentResult = {
          content: content.slice(0, WEB_CONTENT_LIMIT),
          source: base,
          truncated: response.truncated || content.length > WEB_CONTENT_LIMIT,
        };

        health.recordSuccess(base);
        // Cache OCR results for 10 minutes (images are generally immutable)
        ocrCache.set(cacheKey, result, 10 * 60_000);
        return result;
      } catch (error) {
        health.recordFailure(base);
        lastError = error;
      }
    }
    throw new Error(`All OCR services failed: ${lastError instanceof Error ? lastError.message : 'unknown error'}`);
  });
}

/**
 * Converts documents (PDF, DOCX, XLSX, CSV, PPTX) to Markdown via 2md AnyDoc engine
 * with single-flight coalescing and circuit-breaker failover.
 */
export async function parseDocumentThrough2md(
  docInput: string | Buffer | Uint8Array,
  fetchImpl: typeof fetch = fetch,
  options: {
    filename?: string;
    baseUrls?: readonly string[];
    skipCache?: boolean;
    singleFlight?: SingleFlightManager;
    healthTracker?: NodeHealthTracker;
  } = {},
): Promise<GroundingContentResult> {
  const isUrl = typeof docInput === 'string' && (docInput.startsWith('http://') || docInput.startsWith('https://'));
  let safeUrl = '';
  let bufferHash = '';

  if (isUrl) {
    safeUrl = assertSafePublicHttpUrl(docInput as string).toString();
  } else {
    const buf = typeof docInput === 'string' ? Buffer.from(docInput) : Buffer.from(docInput);
    if (buf.byteLength > MAX_DOCUMENT_SIZE_BYTES) {
      throw new Error(`Document size exceeds limit of ${MAX_DOCUMENT_SIZE_BYTES / (1024 * 1024)} MB`);
    }
    bufferHash = createHash('sha256').update(buf).digest('hex');
  }

  const cacheKey = `doc:${isUrl ? safeUrl : bufferHash}`;
  if (!options.skipCache) {
    const cached = docCache.get(cacheKey);
    if (cached) return cached;
  }

  const sf = options.singleFlight ?? globalSingleFlight;
  return sf.do(cacheKey, async () => {
    if (!options.skipCache) {
      const cached = docCache.get(cacheKey);
      if (cached) return cached;
    }

    const health = options.healthTracker ?? globalNodeHealthTracker;
    const baseList = options.baseUrls ?? TWO_MD_BASE_URLS;
    const prioritized = health.getPrioritizedNodes(baseList);

    let lastError: unknown;
    for (let i = 0; i < prioritized.length; i++) {
      const base = prioritized[i];
      if (i > 0) {
        await delay(calculateJitterDelay());
      }
      try {
        const anydocUrl = build2mdRequestUrl(base);
        let requestInit: RequestInit;

        if (isUrl) {
          requestInit = {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Preset': 'agent' },
            body: JSON.stringify({ url: safeUrl }),
          };
        } else {
          const buf = typeof docInput === 'string' ? Buffer.from(docInput) : Buffer.from(docInput);
          const formData = new FormData();
          const filename = options.filename || 'document.pdf';
          formData.append('file', new Blob([buf]), filename);
          requestInit = {
            method: 'POST',
            headers: { Accept: 'application/json', 'X-Preset': 'agent' },
            body: formData,
          };
        }

        const response = await fetchText(anydocUrl, requestInit, fetchImpl);
        const payload = decodeResponse(response.text);
        const extracted = extractReadableContent(payload);
        if (!extracted && typeof payload !== 'string') throw new Error('invalid document response');
        const content = extracted || response.text;
        if (!content.trim()) throw new Error('empty document response');

        const result: GroundingContentResult = {
          content: content.slice(0, WEB_CONTENT_LIMIT),
          source: base,
          truncated: response.truncated || content.length > WEB_CONTENT_LIMIT,
        };

        health.recordSuccess(base);
        docCache.set(cacheKey, result, 10 * 60_000);
        return result;
      } catch (error) {
        health.recordFailure(base);
        lastError = error;
      }
    }
    throw new Error(`All document parsing services failed: ${lastError instanceof Error ? lastError.message : 'unknown error'}`);
  });
}
