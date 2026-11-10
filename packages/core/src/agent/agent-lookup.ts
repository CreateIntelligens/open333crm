import type { Notification, Prisma } from '@prisma/client';

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

export interface NotificationWrite {
  tenantId: string;
  agentId: string;
  type: string;
  title: string;
  body: string;
  clickUrl?: string | null;
}

/** 只需要 $queryRaw：交易 client、PrismaClient 與 tenantScopedClient 都可以傳 */
export type NotificationWriteDb = Pick<Prisma.TransactionClient, '$queryRaw'>;

/**
 * 只在收件成員同租戶、還在、仍啟用時寫入一則站內通知，回傳寫入的通知；不符合時回 null（issue #484）。
 *
 * 每個寫入 notifications 的地方都用這個函式：workers 的 notification:dispatch、API 的 createAndDispatch、
 * 序號明細匯出通知。通知是非同步的，排隊時成員還在，寫入時可能已被永久刪除或已停用。
 * 回 null 時呼叫端略過這則通知並寫 info log，不丟錯、不重試；重新啟用後不補送。
 *
 * 用一個條件寫入（INSERT … SELECT … FROM agents … FOR KEY SHARE），不先查再寫、也不接外鍵錯誤（PR #489 審查）：
 * - 先查再寫之間成員可能被 purgeAgent 刪除，寫入撞 notifications.agentId 外鍵（P2003）。
 * - 在交易內（inTenant）接住 P2003 之後，PostgreSQL 拒絕這個交易的後續查詢，所以不能 catch 後繼續。
 *   savepoint 也可行，但 Prisma 沒有 savepoint API，要再寫 raw SQL；條件寫入一條語句就夠，也不會讓交易中止。
 * - FOR KEY SHARE 鎖住成員列：刪除成員的交易還沒提交時，這條語句等它；它提交後，READ COMMITTED 重新檢查這列，
 *   列已不在就寫入 0 筆。反過來，這條語句先鎖住成員，刪除要等寫入的交易結束（purgeAgent 會先刪他的通知，
 *   之後才寫入的這則會讓刪除因外鍵失敗；這和改動前的時序問題相同，由刪除端重試）。
 * - 停用的競爭不處理：條件判斷之後才停用時，這則通知照樣寫入，可以接受（停用不涉及外鍵）。
 *
 * 欄位名稱與 packages/database/prisma/schema.prisma 的 Notification、Agent 一致（沒有 @map，資料庫欄位就是 camelCase）。
 */
export async function createNotificationForActiveAgent(
  db: NotificationWriteDb,
  input: NotificationWrite,
): Promise<Notification | null> {
  if (!input.agentId) return null;
  const rows = await db.$queryRaw<Notification[]>`
    INSERT INTO "notifications" ("tenantId", "agentId", "type", "title", "body", "clickUrl")
    SELECT a."tenantId", a."id", ${input.type}, ${input.title}, ${input.body}, ${input.clickUrl ?? null}
    FROM "agents" a
    WHERE a."id" = ${input.agentId}::uuid AND a."tenantId" = ${input.tenantId}::uuid AND a."isActive" = true
    FOR KEY SHARE
    RETURNING *`;
  return rows[0] ?? null;
}
