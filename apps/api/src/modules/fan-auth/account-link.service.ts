/**
 * LINE Account Link 身分驗證（OpenSpec design D11）。
 *
 * 為什麼是這個機制：LIFF 的 id_token 需要 LINE Login channel，客戶短期內無法取得。
 * Account Link 只需 Messaging API channel access token，且**由 LINE 平台親自驗證
 * 「開啟連結者即為當初發 token 的對象」**——連結被轉發，他人開啟亦無法通過。
 * 這比自建的一次性連結安全，因為驗證不在我們這端。
 *
 * ⚠️ nonce 存 Redis 而非行程內 Map：正式環境 API 多實例部署，
 * 發起綁定與收 webhook 可能落在不同實例，用 Map 會查無 nonce。
 */
import { randomBytes } from 'node:crypto';
import { redis, logger } from '@open333crm/core';

/**
 * nonce 存活時間。
 * linkToken 官方為 10 分鐘但明載「可能變動」，故此處不與之對齊、
 * 而是取稍長的值：nonce 先過期會讓已通過 LINE 驗證的使用者失敗，體驗更差。
 */
const NONCE_TTL_SECONDS = 20 * 60;

const NONCE_PREFIX = 'fan:accountlink:nonce:';

export interface NoncePayload {
  tenantId: string;
  contactId: string;
  channelId: string;
  lineUid: string;
  createdAt: number;
}

/** CSPRNG、32 bytes（256 bit，遠高於官方要求的 128 bit）、base64。 */
export function generateNonce(): string {
  return randomBytes(32).toString('base64url');
}

export async function storeNonce(nonce: string, payload: NoncePayload): Promise<void> {
  await redis.set(
    `${NONCE_PREFIX}${nonce}`,
    JSON.stringify(payload),
    'EX',
    NONCE_TTL_SECONDS,
  );
}

/**
 * 取出並**立即刪除** nonce（一次性消費）。
 * 用 GETDEL 讓「取出」與「刪除」是單一原子操作——分兩步在併發下會被重放。
 */
export async function consumeNonce(nonce: string): Promise<NoncePayload | null> {
  const key = `${NONCE_PREFIX}${nonce}`;
  let raw: string | null;
  try {
    // GETDEL 需 Redis 6.2+；舊版退回 GET + DEL（仍有極小競態窗，但優於不刪）
    raw = await redis.getdel(key);
  } catch {
    raw = await redis.get(key);
    if (raw) await redis.del(key);
  }
  if (!raw) return null;
  try {
    return JSON.parse(raw) as NoncePayload;
  } catch {
    logger.warn('[AccountLink] nonce 內容無法解析', { nonce: nonce.slice(0, 8) });
    return null;
  }
}

/** 組 LINE 的帳號連動網址。LINE 會在此頁驗證使用者身分。 */
export function buildAccountLinkUrl(linkToken: string, nonce: string): string {
  const params = new URLSearchParams({ linkToken, nonce });
  return `https://access.line.me/dialog/bot/accountLink?${params.toString()}`;
}
