/**
 * 綁定完成後、票據交付顧客端之前的暫存。
 *
 * 時序問題：LINE 把驗證結果送到 webhook，而顧客的瀏覽器正停在一個等待頁。
 * 兩者是不同連線，webhook 無法直接回應瀏覽器。因此以 nonce 為鍵暫存票據，
 * 讓顧客端輪詢取回——nonce 顧客端本來就有（它就在連結裡）。
 */
import { redis, logger } from '@open333crm/core';

/** 顧客端從 LINE 跳轉回來通常在數秒內；給 5 分鐘涵蓋慢速網路。 */
const TICKET_HANDOFF_TTL_SECONDS = 5 * 60;

const PREFIX = 'fan:bindticket:';

export async function storeBindingTicket(nonce: string, ticket: string): Promise<void> {
  await redis.set(`${PREFIX}${nonce}`, ticket, 'EX', TICKET_HANDOFF_TTL_SECONDS);
}

/**
 * 以 nonce 取回票據並刪除。顧客端取走後即失效，
 * 避免同一 nonce 被重複用來取得多張票據。
 */
export async function takeBindingTicket(nonce: string): Promise<string | null> {
  const key = `${PREFIX}${nonce}`;
  try {
    return await redis.getdel(key);
  } catch {
    const v = await redis.get(key);
    if (v) await redis.del(key);
    return v;
  }
}

/** 綁定失敗時寫入原因，讓等待中的顧客端能立即顯示，而非一直輪詢到逾時。 */
export async function storeBindingFailure(nonce: string, reason: string): Promise<void> {
  try {
    await redis.set(`${PREFIX}fail:${nonce}`, reason, 'EX', TICKET_HANDOFF_TTL_SECONDS);
  } catch (err) {
    logger.warn('[FanAuth] 無法寫入綁定失敗狀態', { error: (err as Error).message });
  }
}

export async function takeBindingFailure(nonce: string): Promise<string | null> {
  const key = `${PREFIX}fail:${nonce}`;
  try {
    return await redis.getdel(key);
  } catch {
    const v = await redis.get(key);
    if (v) await redis.del(key);
    return v;
  }
}
