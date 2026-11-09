import type { Prisma } from '@prisma/client';

/** 只需要 agent 這個 model：交易 client、PrismaClient 與 tenantScopedClient 都可以傳 */
export type AgentLookupDb = Pick<Prisma.TransactionClient, 'agent'>;

/**
 * 成員是否還在（同租戶的 agents 有這筆）。不看是否啟用。
 *
 * 用在要把成員 ID 寫進有外鍵的欄位之前（例如稽核的 actorId）：成員可能已被永久刪除（purgeAgent，#414）。
 *
 * @param db 交易內呼叫時傳交易的 client，查詢與後續寫入看到同一個成員狀態
 * @param agentId 空值時回 false，不查（where 的 id 是 undefined 會變成不篩選）
 */
export async function agentExistsInTenant(
  db: AgentLookupDb,
  tenantId: string,
  agentId: string | null | undefined,
): Promise<boolean> {
  if (!agentId) return false;
  const agent = await db.agent.findFirst({ where: { id: agentId, tenantId }, select: { id: true } });
  return agent !== null;
}

/**
 * 這位成員現在能不能收站內通知：同租戶、還在、仍啟用（issue #484）。
 *
 * 每個寫入 notifications 的地方都在寫入前呼叫：workers 的 notification:dispatch、API 的 createAndDispatch、
 * 序號明細匯出通知。通知是非同步的，排隊時成員還在，寫入時可能已被永久刪除（外鍵失敗）或已停用。
 * 回 false 時呼叫端略過這則通知並寫 info log，不丟錯、不重試；重新啟用後不補送。
 */
export async function isNotifiableAgent(
  db: AgentLookupDb,
  tenantId: string,
  agentId: string | null | undefined,
): Promise<boolean> {
  if (!agentId) return false;
  const agent = await db.agent.findFirst({ where: { id: agentId, tenantId, isActive: true }, select: { id: true } });
  return agent !== null;
}
