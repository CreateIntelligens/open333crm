/**
 * Downstream webhook forwarding (any channel).
 *
 * Forwards the *original* inbound webhook (raw body + original request headers,
 * unchanged) to a single admin-configured downstream URL. Best-effort,
 * fire-and-forget: one request with a timeout, no retries, and the downstream
 * response/outcome is ignored entirely. See openspec change
 * `line-downstream-webhook`.
 */

import { lookup } from 'node:dns/promises';
import { z } from 'zod';
import { logger } from '@open333crm/core';

// ─── Config schema + helper ──────────────────────────────────────────────

export const downstreamWebhookConfigSchema = z.object({
  enabled: z.boolean(),
  url: z
    .string()
    .url()
    .refine((u) => u.startsWith('https://'), { message: 'url must use https' }),
  mode: z.enum(['immediate', 'after']),
  timeoutMs: z.number().int().positive().max(60000).optional(),
});

export type DownstreamWebhookConfig = z.infer<typeof downstreamWebhookConfigSchema>;

/**
 * Extract a valid, enabled downstream-webhook config from a channel's
 * `settings` JSON. Returns null when absent, disabled, or malformed
 * (fail-safe: never forward on invalid config).
 */
export function getDownstreamWebhookConfig(settings: unknown): DownstreamWebhookConfig | null {
  if (!settings || typeof settings !== 'object') return null;
  const raw = (settings as Record<string, unknown>).downstreamWebhook;
  if (!raw) return null;
  const parsed = downstreamWebhookConfigSchema.safeParse(raw);
  if (!parsed.success || !parsed.data.enabled) return null;
  return parsed.data;
}

// ─── SSRF guard ───────────────────────────────────────────────────────────

function ipv4ToInt(ip: string): number | null {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((p) => p > 255)) return null;
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

function isBlockedIpv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n === null) return false;
  const inRange = (base: string, bits: number): boolean => {
    const b = ipv4ToInt(base);
    if (b === null) return false;
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (n & mask) === (b & mask);
  };
  return (
    inRange('0.0.0.0', 8) || // "this" network / 0.0.0.0
    inRange('10.0.0.0', 8) || // private
    inRange('100.64.0.0', 10) || // CGNAT
    inRange('127.0.0.0', 8) || // loopback
    inRange('169.254.0.0', 16) || // link-local
    inRange('172.16.0.0', 12) || // private
    inRange('192.0.0.0', 24) || // IETF protocol assignments
    inRange('192.168.0.0', 16) || // private
    inRange('198.18.0.0', 15) || // benchmarking
    inRange('224.0.0.0', 4) || // multicast
    inRange('240.0.0.0', 4) // reserved
  );
}

function isBlockedIpv6(ip: string): boolean {
  const addr = ip.toLowerCase();
  if (addr === '::1' || addr === '::') return true; // loopback / unspecified
  const mapped = addr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); // IPv4-mapped
  if (mapped) return isBlockedIpv4(mapped[1]);
  if (/^f[cd][0-9a-f]{2}:/.test(addr)) return true; // fc00::/7 unique-local
  if (/^fe[89ab][0-9a-f]:/.test(addr)) return true; // fe80::/10 link-local
  return false;
}

/**
 * Resolve the URL's host and block loopback / private / link-local / reserved
 * targets. Requires https. Blocks (returns true) on any error or DNS failure.
 */
export async function isBlockedUrl(rawUrl: string): Promise<boolean> {
  let host: string;
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== 'https:') return true;
    host = u.hostname.replace(/^\[|\]$/g, ''); // strip IPv6 brackets
  } catch {
    return true;
  }
  try {
    const results = await lookup(host, { all: true });
    if (results.length === 0) return true;
    for (const r of results) {
      if (r.family === 4 && isBlockedIpv4(r.address)) return true;
      if (r.family === 6 && isBlockedIpv6(r.address)) return true;
    }
    return false;
  } catch {
    return true; // cannot verify → block
  }
}

// ─── Forwarder ──────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 10000;

// Transport-level headers undici must set for the new target; forwarding the
// inbound values verbatim would produce an invalid request to a different host.
const STRIP_HEADERS = new Set(['host', 'content-length']);

/**
 * Forward the original raw webhook to the downstream URL. Best-effort,
 * fire-and-forget: single request, timeout only (no retry), downstream
 * response and outcome are ignored. Never throws.
 *
 * The original request headers and body are relayed **unchanged** — no added
 * headers, no signing, no content-type rewriting — so the downstream receives
 * the platform's request as-is (and can verify its original signature header).
 */
export async function forwardToDownstream(
  config: DownstreamWebhookConfig,
  rawBody: Buffer,
  headers: Record<string, string>,
  channel: { id: string },
): Promise<void> {
  if (await isBlockedUrl(config.url)) {
    logger.warn('[DownstreamWebhook] Blocked SSRF target — not forwarding', {
      channelId: channel.id,
      mode: config.mode,
    });
    return;
  }

  const outHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (!STRIP_HEADERS.has(k.toLowerCase())) outHeaders[k] = v;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    await fetch(config.url, {
      method: 'POST',
      headers: outHeaders,
      body: rawBody,
      signal: controller.signal,
    });
    // Result intentionally ignored (best-effort).
  } catch (err) {
    logger.warn('[DownstreamWebhook] Forward failed (ignored)', {
      channelId: channel.id,
      mode: config.mode,
      error: (err as Error).message,
    });
  } finally {
    clearTimeout(timeout);
  }
}
