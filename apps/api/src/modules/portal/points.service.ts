/**
 * Points ledger service — manages contact point balances via append-only transactions.
 */

import type { TenantDb } from '../../lib/tenant-db.js';

/**
 * Get current point balance for a contact.
 */
export async function getPointBalance(prisma: TenantDb, contactId: string, tenantId?: string): Promise<number> {
  return (await getLatestPointEntry(prisma, contactId, tenantId))?.balance ?? 0;
}

/**
 * 帳本最新一筆（餘額與時間）。餘額規則只寫在這裡：取 createdAt 最新一筆的 balance。
 * 合併引擎轉移點數時也用這支，確保與點數頁算出的餘額一致。
 */
export async function getLatestPointEntry(
  prisma: TenantDb,
  contactId: string,
  tenantId?: string,
): Promise<{ balance: number; createdAt: Date } | null> {
  return prisma.pointTransaction.findFirst({
    where: { contactId, ...(tenantId ? { tenantId } : {}) },
    orderBy: { createdAt: 'desc' },
    select: { balance: true, createdAt: true },
  });
}

/**
 * Add a point transaction (positive or negative amount).
 * Returns the new transaction record.
 */
export async function addPointTransaction(
  prisma: TenantDb,
  data: {
    tenantId: string;
    contactId: string;
    amount: number;
    type: string; // activity_submit | admin_adjust | reward_redeem
    refId?: string;
    note?: string;
  },
) {
  const currentBalance = await getPointBalance(prisma, data.contactId);
  const newBalance = currentBalance + data.amount;

  return prisma.pointTransaction.create({
    data: {
      tenantId: data.tenantId,
      contactId: data.contactId,
      amount: data.amount,
      balance: newBalance,
      type: data.type,
      refId: data.refId,
      note: data.note,
    },
  });
}

/**
 * List point transactions for a contact (paginated, newest first).
 */
export async function listPointTransactions(
  prisma: TenantDb,
  tenantId: string,
  contactId: string,
  page = 1,
  limit = 20,
) {
  const [items, total] = await Promise.all([
    prisma.pointTransaction.findMany({
      where: { tenantId, contactId },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.pointTransaction.count({ where: { tenantId, contactId } }),
  ]);

  return { items, total, page, limit };
}
