/**
 * 向 LINE 驗證 LIFF 取得的 ID token（add-coupon-system design D20）。
 * LINE 會檢查 token 的簽章、效期與 aud 是否等於 client_id（Login Channel ID）；不需要 Channel Secret。
 */
import { logger } from '@open333crm/core';

const VERIFY_URL = 'https://api.line.me/oauth2/v2.1/verify';
const TIMEOUT_MS = 8000;

/** ok：LINE 接受；rejected：LINE 不接受（過期、竄改、client_id 不符）；unreachable：連不上 LINE 或 LINE 端錯誤 */
export type LineIdTokenCheck = { result: 'ok'; sub: string } | { result: 'rejected' } | { result: 'unreachable' };

/**
 * 驗證 ID token 並分辨失敗原因（change add-liff-config-test D4）：測試 LIFF 設定時，
 * 「LINE 不接受」代表設定錯誤，「連不上 LINE」只要稍後重試。
 */
export async function checkLineIdToken(
  idToken: string,
  clientId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<LineIdTokenCheck> {
  try {
    const res = await fetchImpl(VERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ id_token: idToken, client_id: clientId }).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status >= 500) return { result: 'unreachable' };
    if (!res.ok) return { result: 'rejected' };
    const data = (await res.json()) as { sub?: unknown; aud?: unknown };
    // LINE 已檢查 aud，這裡再確認一次，避免回應格式改變時誤用別人的 token
    if (typeof data.sub !== 'string' || data.aud !== clientId) return { result: 'rejected' };
    return { result: 'ok', sub: data.sub };
  } catch (err) {
    logger.warn('[LineLogin] 無法向 LINE 驗證 ID token', { error: (err as Error).message });
    return { result: 'unreachable' };
  }
}

/** 驗證通過回傳 LINE userId（sub）；不通過或連不上 LINE 回 null，呼叫端改走 One ID 登記 */
export async function verifyLineIdToken(
  idToken: string,
  clientId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ sub: string } | null> {
  const checked = await checkLineIdToken(idToken, clientId, fetchImpl);
  return checked.result === 'ok' ? { sub: checked.sub } : null;
}
