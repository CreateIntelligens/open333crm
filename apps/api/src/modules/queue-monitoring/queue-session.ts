/**
 * 監控 cookie（change queue-monitoring，design 決策 3）。
 *
 * 瀏覽器開啟 bull-board 的畫面時不會帶 Authorization 標頭，所以平台管理員先以平台 JWT 換發這個 cookie。
 * 值是 `<payload>.<簽章>`：payload 含平台帳號 id 與到期時間，簽章是 HMAC-SHA256，
 * 金鑰由 PLATFORM_JWT_SECRET 以 HKDF 衍生。金鑰與平台 JWT 不同，所以 cookie 與平台 JWT 不能互換。
 */
import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';

export const QUEUE_SESSION_COOKIE = 'queue_dashboard_session';
export const QUEUE_SESSION_TTL_SECONDS = 3_600;

function deriveKey(secret: string): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, '', 'queue-dashboard', 32));
}

function sign(secret: string, payload: string): string {
  return createHmac('sha256', deriveKey(secret)).update(payload).digest('base64url');
}

export function signQueueSession(secret: string, platformUserId: string, now = Date.now()): string {
  const payload = Buffer.from(
    JSON.stringify({ sub: platformUserId, exp: Math.floor(now / 1000) + QUEUE_SESSION_TTL_SECONDS }),
  ).toString('base64url');
  return `${payload}.${sign(secret, payload)}`;
}

/** 簽章正確且沒有過期時回傳平台帳號 id，否則回傳 null */
export function verifyQueueSession(secret: string, value: string | undefined, now = Date.now()): string | null {
  if (!value) return null;
  const [payload, signature, extra] = value.split('.');
  if (!payload || !signature || extra !== undefined) return null;
  const expected = Buffer.from(sign(secret, payload));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const { sub, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { sub?: unknown; exp?: unknown };
    if (typeof sub !== 'string' || typeof exp !== 'number' || exp * 1000 <= now) return null;
    return sub;
  } catch {
    return null;
  }
}
