import type { Prisma } from '@prisma/client';
import { agentExistsInTenant } from '@open333crm/core';

/**
 * 發起資料匯出或資料刪除請求的成員是否還在（同租戶的 agents 有這筆）。
 *
 * 請求排隊中，發起的成員可能已被永久刪除（purgeAgent，issue #414）：請求的 requestedBy 變成空值，
 * 工作內容的 requestedBy 仍是原本的 ID。這時稽核的 actorId 與通知的 agentId 都不能用這個 ID，
 * 否則違反外鍵。只看存在、不看是否啟用：停用的成員仍可當稽核的 actorId；
 * 通知要不要送由 notification:dispatch 的 isNotifiableAgent() 決定（#484）。
 *
 * @param db 交易內呼叫時傳交易的 client，查詢與後續寫入看到同一個成員狀態
 * @param agentId 工作內容的 requestedBy；空值時回 false，不查（where 的 id 是 undefined 會變成不篩選）
 */
export function requesterExists(
  db: Pick<Prisma.TransactionClient, 'agent'>,
  tenantId: string,
  agentId: string | null | undefined,
): Promise<boolean> {
  return agentExistsInTenant(db, tenantId, agentId);
}
