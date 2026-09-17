import type { PrismaClient } from '@prisma/client';
import { logger } from '@open333crm/core';

/**
 * 清除已到期的時效標籤。
 *
 * 為何用排程刪除而非查詢時過濾：標籤在系統中有十餘處讀取點
 * （分眾、automation facts、聯絡人詳情、匯出…），逐一加過濾條件
 * 必然會漏，且漏掉的地方會安靜地把過期標籤當成有效。
 * 直接刪列讓所有讀取點自動一致。
 *
 * `expiresAt` 為 null 者是永久標籤，不受影響。
 */
export async function handleTagExpiryCleanup(prisma: PrismaClient, now = new Date()) {
  const result = await prisma.contactTag.deleteMany({
    where: { expiresAt: { not: null, lte: now } },
  });
  if (result.count > 0) {
    logger.info('[TagExpiry] 已清除到期標籤', { count: result.count });
  }
  return { removed: result.count };
}
