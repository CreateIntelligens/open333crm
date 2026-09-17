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
import type { PrismaClient } from '@prisma/client';
import { redis, logger } from '@open333crm/core';
import { withTenant } from '../../lib/tenant-db.js';
import { signFanToken } from '../portal/portal-auth.service.js';

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

export type ExchangeResult =
  | { ok: true; data: { token: string; contactId: string; tenantId: string } }
  | { ok: false; reason: 'TICKET_INVALID' | 'NOT_FOUND' };

/**
 * 票據換 fan token：取出票據（一次性）→ 在票據所屬租戶下確認聯絡人仍存在 → 簽發 token。
 * 聯絡人查詢走 withTenant，RLS 兜底，不使用 BYPASSRLS 連線。
 */
export async function exchangeAuthTicket(prisma: PrismaClient, ticket: string): Promise<ExchangeResult> {
  const claimed = await consumeAuthTicket(ticket);
  if (!claimed) return { ok: false, reason: 'TICKET_INVALID' };

  const contact = await withTenant(prisma, claimed.tenantId, (tx) =>
    tx.contact.findFirst({
      where: { id: claimed.contactId, tenantId: claimed.tenantId },
      select: { id: true },
    }),
  );
  if (!contact) return { ok: false, reason: 'NOT_FOUND' };

  return {
    ok: true,
    data: {
      token: signFanToken(claimed.contactId, claimed.tenantId),
      contactId: claimed.contactId,
      tenantId: claimed.tenantId,
    },
  };
}
