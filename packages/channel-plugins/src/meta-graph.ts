/**
 * FB／IG Graph API 共用的呼叫與錯誤正規化（change add-comment-keyword-private-reply，design「外掛契約」錯誤正規化）。
 *
 * 留言擴充的方法一律把 Meta 錯誤轉成 MetaErrorInfo（原因代碼＋是否值得重試），comment-reply 模組只看
 * reason／transient，不解析 Meta 錯誤碼；FB／IG 的錯誤碼差異留在外掛內（AGENTS.md 結構規則 5）。
 *
 * 對照表（design「外掛契約」）：
 *   190 → TOKEN_EXPIRED；10、200～299 → PERMISSION_MISSING；551 → USER_UNAVAILABLE；100＋subcode 33 → COMMENT_NOT_FOUND；
 *   10900 → ALREADY_REPLIED（社群經驗，待實測）；10903 → EXPIRED_BY_META（社群經驗，待實測）；
 *   4、17、32、613、80001～80014 → RATE_LIMITED（transient，帶 retryAfterMs）；fetch 丟錯、HTTP 5xx → NETWORK（transient）；其他 → UNKNOWN。
 *   對粉專私訊（RECIPIENT_IS_PAGE）的錯誤碼未知（待實測 M2），目前會落在 UNKNOWN。
 *   APP_NOT_APPROVED 不在這裡判斷：外掛不知道平台的測試階段旗標，由 comment-reply 模組從 PERMISSION_MISSING 轉換。
 */
import { createHmac } from 'node:crypto';
import type { MetaErrorInfo } from './index.js';

const RATE_LIMIT_CODES = new Set([4, 17, 32, 613]);

/** Graph API 回應 body 裡的 error 物件 */
interface GraphErrorBody {
  message?: string;
  code?: number;
  error_subcode?: number;
  fbtrace_id?: string;
}

/** subscribeFields 等「失敗就丟錯」的方法丟出的錯誤；路由依 info.reason 轉成 409／502 */
export class MetaApiError extends Error {
  readonly info: MetaErrorInfo;
  constructor(info: MetaErrorInfo) {
    super(info.message);
    this.name = 'MetaApiError';
    this.info = info;
  }
}

export function appSecretProof(token: string, appSecret: string): string {
  return createHmac('sha256', appSecret).update(token).digest('hex');
}

/** `X-Business-Use-Case-Usage` 的 estimated_time_to_regain_access（分鐘）取最大值，轉毫秒 */
function retryAfterFrom(headers: Headers | undefined): number | undefined {
  const raw = headers?.get('x-business-use-case-usage');
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Record<string, Array<{ estimated_time_to_regain_access?: number }>>;
    let minutes = 0;
    for (const list of Object.values(parsed)) {
      for (const item of Array.isArray(list) ? list : []) {
        minutes = Math.max(minutes, Number(item?.estimated_time_to_regain_access) || 0);
      }
    }
    return minutes > 0 ? minutes * 60_000 : undefined;
  } catch {
    return undefined;
  }
}

export function normalizeMetaError(error: GraphErrorBody | undefined, status: number, headers?: Headers): MetaErrorInfo {
  const code = typeof error?.code === 'number' ? error.code : undefined;
  const subcode = typeof error?.error_subcode === 'number' ? error.error_subcode : undefined;
  const base = {
    ...(code !== undefined ? { code } : {}),
    ...(subcode !== undefined ? { subcode } : {}),
    ...(error?.fbtrace_id ? { traceId: error.fbtrace_id } : {}),
    message: error?.message ?? `Graph API HTTP ${status}`,
  };

  if (status >= 500) return { ...base, reason: 'NETWORK', transient: true };
  if (code === 190) return { ...base, reason: 'TOKEN_EXPIRED', transient: false };
  if (code === 10 || (code !== undefined && code >= 200 && code <= 299)) return { ...base, reason: 'PERMISSION_MISSING', transient: false };
  if (code === 551) return { ...base, reason: 'USER_UNAVAILABLE', transient: false };
  if (code === 100 && subcode === 33) return { ...base, reason: 'COMMENT_NOT_FOUND', transient: false };
  // 待實測（design「需要 UAT 實測的項目」M2）：碼來自社群經驗，實測後回填
  if (code === 10900) return { ...base, reason: 'ALREADY_REPLIED', transient: false };
  if (code === 10903) return { ...base, reason: 'EXPIRED_BY_META', transient: false };
  if (code !== undefined && (RATE_LIMIT_CODES.has(code) || (code >= 80001 && code <= 80014))) {
    const retryAfterMs = retryAfterFrom(headers);
    return { ...base, reason: 'RATE_LIMITED', transient: true, ...(retryAfterMs ? { retryAfterMs } : {}) };
  }
  return { ...base, reason: 'UNKNOWN', transient: false };
}

export function networkError(err: unknown): MetaErrorInfo {
  return { message: err instanceof Error ? err.message : String(err), reason: 'NETWORK', transient: true };
}

export type GraphResult<T = Record<string, any>> = { ok: true; body: T } | { ok: false; error: MetaErrorInfo };

/** 讀 Graph API 回應：HTTP 失敗、body 帶 error 都轉成 MetaErrorInfo */
export async function readGraphResponse<T = Record<string, any>>(res: Response): Promise<GraphResult<T>> {
  const body = (await res.json().catch(() => null)) as (Record<string, any> & { error?: GraphErrorBody }) | null;
  if (!res.ok || body?.error) return { ok: false, error: normalizeMetaError(body?.error, res.status, res.headers) };
  return { ok: true, body: (body ?? {}) as T };
}

/** 呼叫 Graph API，不丟錯：fetch 丟錯回 NETWORK */
export async function graphFetch<T = Record<string, any>>(url: string, init?: RequestInit): Promise<GraphResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    return { ok: false, error: networkError(err) };
  }
  return readGraphResponse<T>(res);
}

/** 呼叫 Graph API，失敗丟 MetaApiError */
export async function graphFetchOrThrow<T = Record<string, any>>(url: string, init?: RequestInit): Promise<T> {
  const r = await graphFetch<T>(url, init);
  if (!r.ok) throw new MetaApiError(r.error);
  return r.body;
}

/** Graph API 的時間格式 `2026-11-11T02:00:00+0000`（時區沒有冒號）轉 Date */
export function parseGraphTime(value: unknown): Date | null {
  if (typeof value !== 'string' || !value) return null;
  const d = new Date(value.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 掃最近貼文時最多翻幾頁（design「外掛契約」resolvePostUrl） */
export const RESOLVE_URL_MAX_PAGES = 4;

/** 貼文摘要長度 */
export const EXCERPT_MAX_CHARS = 100;

export function excerptOf(text: unknown): string {
  const s = typeof text === 'string' ? text : '';
  return Array.from(s).slice(0, EXCERPT_MAX_CHARS).join('');
}

export function safeJsonParse(raw: Buffer): any {
  try {
    return JSON.parse(raw.toString('utf-8'));
  } catch {
    return null;
  }
}

export function parseUrl(input: string): URL | null {
  try {
    const u = new URL(input.trim());
    return u.protocol === 'https:' || u.protocol === 'http:' ? u : null;
  } catch {
    return null;
  }
}

/** host 是否為某網域本身或其子網域（防 `facebook.com.evil.example`） */
export function hostIs(url: URL, domain: string): boolean {
  const h = url.hostname.toLowerCase();
  return h === domain || h.endsWith(`.${domain}`);
}
