/**
 * Points ledger service — manages contact point balances via append-only transactions.
 *
 * 每個函式收呼叫端的 TenantCtx（#337 階段 3，AGENTS.md 結構規則 2）。
 * 呼叫端：portal 的 flow，以及 contact-merge.service.ts 合併、解除合併時轉移點數。
 */

import type { TenantCtx } from '../../lib/tenant-ctx.js';

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
 */
export async function addPointTransaction(
  ctx: TenantCtx,
  data: {
    contactId: string;
    amount: number;
    type: string; // activity_submit | admin_adjust | reward_redeem
    refId?: string;
    note?: string;
    /** 指定寫入時間（合併轉移點數時用，確保排在雙方既有交易之後）；省略為現在 */
    createdAt?: Date;
  },
) {
  const currentBalance = await getPointBalance(ctx, data.contactId);
  const newBalance = currentBalance + data.amount;

  return ctx.tx.pointTransaction.create({
    data: {
      tenantId: ctx.tenantId,
      contactId: data.contactId,
      amount: data.amount,
      balance: newBalance,
      type: data.type,
      refId: data.refId,
      note: data.note,
      ...(data.createdAt ? { createdAt: data.createdAt } : {}),
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
