/**
 * Points ledger service — manages contact point balances via append-only transactions.
 */

import type { PrismaClient } from '@prisma/client';

/**
 * Get current point balance for a contact.
 */
export async function getPointBalance(prisma: PrismaClient, contactId: string): Promise<number> {
  const latest = await prisma.pointTransaction.findFirst({
    where: { contactId },
    orderBy: { createdAt: 'desc' },
    select: { balance: true },
  });
  return latest?.balance ?? 0;
}

/**
 * Add a point transaction (positive or negative amount).
 * Returns the new transaction record.
 */
export async function addPointTransaction(
  prisma: PrismaClient,
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
  prisma: PrismaClient,
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
