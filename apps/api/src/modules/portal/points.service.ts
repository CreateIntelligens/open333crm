/**
 * Points ledger service — manages contact point balances via append-only transactions.
 *
 * 每個函式收呼叫端的 TenantCtx（#337 階段 3，AGENTS.md 結構規則 2）。
 * 呼叫端：portal 的 flow，以及 contact-merge.service.ts 合併、解除合併時轉移點數。
 */

import type { TenantCtx } from '../../lib/tenant-ctx.js';

/**
 * 鎖住聯絡人的積分帳本到交易結束。寫入帳本前要先鎖住再讀餘額：
 * 同時寫入同一位聯絡人時，後一筆等前一筆 commit 後才讀得到它的餘額，不會兩筆都以同一個餘額計算。
 * 同時鎖多位聯絡人時依 id 排序，避免「A 轉 B」與「B 轉 A」同時進行時互相等待而死結。
 * 同一個交易重複鎖同一位聯絡人不會卡住。
 */
export async function lockPointLedgers(ctx: TenantCtx, contactIds: string[]): Promise<void> {
  for (const contactId of [...new Set(contactIds)].sort()) {
    await ctx.tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`point-ledger:${contactId}`}, 0))`;
  }
}

/**
 * Get current point balance for a contact.
 */
export async function getPointBalance(ctx: TenantCtx, contactId: string): Promise<number> {
  return (await getLatestPointEntry(ctx, contactId))?.balance ?? 0;
}

/**
 * 帳本最新一筆（餘額與時間）。餘額規則只寫在這裡：取 createdAt 最新一筆的 balance。
 * 合併引擎轉移點數時也用這支，確保與點數頁算出的餘額一致。
 */
export async function getLatestPointEntry(
  ctx: TenantCtx,
  contactId: string,
): Promise<{ balance: number; createdAt: Date } | null> {
  return ctx.tx.pointTransaction.findFirst({
    where: { contactId, tenantId: ctx.tenantId },
    orderBy: { createdAt: 'desc' },
    select: { balance: true, createdAt: true },
  });
}

/**
 * Add a point transaction (positive or negative amount).
 * Returns the new transaction record.
 *
 * 寫入時間取 createdAt（省略為現在）與「最新一筆 + 1 毫秒」中較晚的一個：
 * 同一毫秒內連續寫入時，「取最新一筆」仍取得到後寫入的那筆。
 */
export async function addPointTransaction(
  ctx: TenantCtx,
  data: {
    contactId: string;
    amount: number;
    type: string; // activity_submit | admin_adjust | reward_redeem
    refId?: string;
    note?: string;
    /** 指定寫入時間（合併轉移點數時用，讓轉出與轉入同一個時間）；省略為現在 */
    createdAt?: Date;
  },
) {
  await lockPointLedgers(ctx, [data.contactId]);
  const latest = await getLatestPointEntry(ctx, data.contactId);
  const newBalance = (latest?.balance ?? 0) + data.amount;
  const requested = (data.createdAt ?? new Date()).getTime();
  const createdAt = new Date(latest ? Math.max(requested, latest.createdAt.getTime() + 1) : requested);

  return ctx.tx.pointTransaction.create({
    data: {
      tenantId: ctx.tenantId,
      contactId: data.contactId,
      amount: data.amount,
      balance: newBalance,
      type: data.type,
      refId: data.refId,
      note: data.note,
      createdAt,
    },
  });
}

/**
 * List point transactions for a contact (paginated, newest first).
 */
export async function listPointTransactions(
  ctx: TenantCtx,
  contactId: string,
  page = 1,
  limit = 20,
) {
  const { tx, tenantId } = ctx;
  // 同一個交易內依序查詢（交易用戶端不支援並行查詢）
  const items = await tx.pointTransaction.findMany({
    where: { tenantId, contactId },
    orderBy: { createdAt: 'desc' },
    skip: (page - 1) * limit,
    take: limit,
  });
  const total = await tx.pointTransaction.count({ where: { tenantId, contactId } });

  return { items, total, page, limit };
}
