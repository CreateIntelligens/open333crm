/**
 * 對外呼叫的通用防護。與特定客戶無關——任何客戶的端點都走這裡。
 *
 * 端點由後台填入，等同讓租戶管理員指定伺服器要連的位址；
 * 若不設限，可被用來探測內網或雲端 metadata（SSRF）。
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/** 回應大小上限。對方回超大內容不該吃爆我們的記憶體。 */
export const MAX_RESPONSE_BYTES = 1024 * 1024; // 1 MB

export type EndpointRejection =
  | 'INVALID_URL'
  | 'PROTOCOL_NOT_ALLOWED'
  | 'PRIVATE_ADDRESS'
  | 'DNS_FAILED';

/**
 * 判斷 IP 是否落在不可對外呼叫的網段。
 * 涵蓋私有網段、loopback、link-local（含雲端 metadata 169.254.169.254）。
 */
export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const p = ip.split('.').map(Number);
    if (p[0] === 10) return true;
    if (p[0] === 127) return true;
    if (p[0] === 0) return true;
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    if (p[0] === 192 && p[1] === 168) return true;
    if (p[0] === 169 && p[1] === 254) return true; // link-local／雲端 metadata
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true; // CGNAT
    return false;
  }
  if (v === 6) {
    const s = ip.toLowerCase().replace(/^\[|\]$/g, '');
    if (s === '::1' || s === '::') return true;
    if (s.startsWith('fc') || s.startsWith('fd')) return true; // unique local
    if (s.startsWith('fe80')) return true; // link-local
    // IPv4-mapped：::ffff:127.0.0.1
    const m = s.match(/^::ffff:(.+)$/);
    if (m && isIP(m[1]) === 4) return isPrivateAddress(m[1]);
    return false;
  }
  return false;
}

/**
 * 檢查端點是否可安全呼叫。
 *
 * ⚠️ 仍有 DNS rebinding 的殘餘風險（解析通過後、實際連線前 DNS 可能改變）。
 * 完整防護需在 socket 層攔截，屬基礎設施工作；此處先擋掉直接填內網位址的情況。
 * 測試環境（NODE_ENV=test）放行 127.0.0.1，否則本機 mock server 測不了。
 */
export async function assertEndpointAllowed(
  rawUrl: string,
): Promise<{ ok: true } | { ok: false; reason: EndpointRejection; detail?: string }> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: 'INVALID_URL' };
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, reason: 'PROTOCOL_NOT_ALLOWED', detail: url.protocol };
  }

  const allowLocal = process.env.MEMBER_BINDING_ALLOW_LOCAL === '1';
  const host = url.hostname.replace(/^\[|\]$/g, '');

  if (isIP(host)) {
    if (isPrivateAddress(host) && !allowLocal) {
      return { ok: false, reason: 'PRIVATE_ADDRESS', detail: host };
    }
    return { ok: true };
  }

  try {
    const records = await lookup(host, { all: true });
    for (const r of records) {
      if (isPrivateAddress(r.address) && !allowLocal) {
        return { ok: false, reason: 'PRIVATE_ADDRESS', detail: r.address };
      }
    }
  } catch (err) {
    return { ok: false, reason: 'DNS_FAILED', detail: (err as Error).message };
  }

  return { ok: true };
}

/**
 * 讀取回應但限制大小。用串流逐塊累加，超過上限即中止——
 * 先 text() 再檢查長度已經太遲，記憶體早就吃進去了。
 */
export async function readBodyLimited(
  response: Response,
  maxBytes = MAX_RESPONSE_BYTES,
): Promise<{ ok: true; text: string } | { ok: false; reason: 'TOO_LARGE' }> {
  const declared = response.headers.get('content-length');
  if (declared && Number(declared) > maxBytes) {
    return { ok: false, reason: 'TOO_LARGE' };
  }
  if (!response.body) {
    return { ok: true, text: '' };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return { ok: false, reason: 'TOO_LARGE' };
    }
    chunks.push(value);
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.length;
  }
  return { ok: true, text: new TextDecoder().decode(merged) };
}
