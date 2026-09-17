/**
 * 一次性認證票據。
 *
 * 為什麼需要這層：Account Link 的驗證結果由 LINE 送到我們的 **webhook**，
 * 但要拿 token 的是**顧客的瀏覽器**——兩者是不同的連線。因此驗證成功後
 * 先發一張短效票據，隨連結帶給顧客，由顧客端換成 fan token。
 *
 * 票據與 design D10 的 claimToken 不同：claimToken 是「券的所有權」，
 * 此票據是「已驗證身分的憑證」，效期更短（分鐘級）且只能用一次。
 */
import { randomBytes } from 'node:crypto';
import { redis, logger } from '@open333crm/core';

/**
 * 票據效期。顧客從 LINE 驗證完成到開啟頁面通常在數秒內，
 * 給 5 分鐘已足夠涵蓋網路延遲與手動點擊，再長只是擴大被竊用的窗口。
 */
const TICKET_TTL_SECONDS = 5 * 60;

const TICKET_PREFIX = 'fan:authticket:';

export interface TicketPayload {
  tenantId: string;
  contactId: string;
}

export function generateAuthTicket(): string {
  return randomBytes(32).toString('base64url');
}

export async function issueAuthTicket(payload: TicketPayload): Promise<string> {
  const ticket = generateAuthTicket();
  await redis.set(`${TICKET_PREFIX}${ticket}`, JSON.stringify(payload), 'EX', TICKET_TTL_SECONDS);
  return ticket;
}

/** 取出並立即刪除（一次性）。用 GETDEL 保證原子性，避免併發重放。 */
export async function consumeAuthTicket(ticket: string): Promise<TicketPayload | null> {
  const key = `${TICKET_PREFIX}${ticket}`;
  let raw: string | null;
  try {
    raw = await redis.getdel(key);
  } catch {
    raw = await redis.get(key);
    if (raw) await redis.del(key);
  }
  if (!raw) return null;
  try {
    return JSON.parse(raw) as TicketPayload;
  } catch {
    logger.warn('[FanAuth] 票據內容無法解析');
    return null;
  }
}
