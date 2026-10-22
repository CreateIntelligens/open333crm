/**
 * 副作用的認領紀錄（change outbox-event-delivery，side-effect-claims）。
 *
 * 不能重複的副作用（對客人發訊息、規則動作、衍生事件）執行前，先以認領鍵寫一筆紀錄。
 * 寫入用 INSERT … ON CONFLICT DO NOTHING：鍵已存在時不丟錯，所在的交易可以繼續使用。
 * 另一個交易同時寫入同一個鍵時，PostgreSQL 等對方 commit 或 rollback 才決定結果。
 */
import type { Prisma } from '@prisma/client';
import { claimOne } from '../db/db-invariants.js';

/**
 * 認領的種類與鍵的組成（design 決策 2）：
 * - bot_reply：入站訊息 id
 * - automation_action：觸發事件 id，子鍵 `<規則 id>#<動作序號>`
 * - sentiment：入站訊息 id
 * - keyword_matched：入站訊息 id，子鍵是規則 id
 */
export type SideEffectKind = 'bot_reply' | 'automation_action' | 'sentiment' | 'keyword_matched';

export interface SideEffectKey {
  tenantId: string;
  kind: SideEffectKind;
  /** uuid，不設外鍵 */
  sourceId: string;
  subKey?: string;
}

type ClaimDb = Pick<Prisma.TransactionClient, 'sideEffectClaim'>;

/** 以認領鍵寫入一筆紀錄；回傳 true 代表這次認領成功，false 代表已經有人認領 */
export async function claimSideEffect(tx: ClaimDb, key: SideEffectKey): Promise<boolean> {
  const row = { tenantId: key.tenantId, kind: key.kind, sourceId: key.sourceId, subKey: key.subKey ?? '' };
  return claimOne(() => tx.sideEffectClaim.createMany({ data: [row], skipDuplicates: true }));
}

/**
 * 認領鍵是否已有紀錄。只用在呼叫 LLM 之前省下費用：查不到時仍要在交易內 claimSideEffect()，
 * 兩次處理可能同時通過這個檢查。
 */
export async function hasSideEffectClaim(db: ClaimDb, key: SideEffectKey): Promise<boolean> {
  const count = await db.sideEffectClaim.count({
    where: { tenantId: key.tenantId, kind: key.kind, sourceId: key.sourceId, subKey: key.subKey ?? '' },
  });
  return count > 0;
}
