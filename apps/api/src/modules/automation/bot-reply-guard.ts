/**
 * 每則入站訊息最多一則機器人回覆（change outbox-event-delivery：automation-engine「每則入站訊息最多一則機器人回覆」）。
 *
 * agent 回覆、KB 自動回覆與自動轉接的轉接訊息，都以「bot_reply + 入站訊息 id」認領：
 * - 呼叫 LLM 之前用 alreadyReplied() 檢查，已經有人回覆就不花 LLM 費用。
 * - 寫入回覆時用 persist()：在綁定租戶的交易內先認領，再寫入。認領失敗時不寫入；
 *   寫入回傳 null（例如對話已不是 BOT_HANDLED）時 rollback，認領也不留下。
 * 認領 commit 之後才送出回覆。送出失敗不還原認領，所以回覆最多送出一次。
 * 認領的交易失敗時丟 ClaimTransactionError：呼叫端不能把它當成「這次沒有回覆」吞掉，
 * 要讓 job 失敗、由佇列重試（side-effect-claims「認領 commit 之前的失敗由佇列重試」）。
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import { claimSideEffect, hasSideEffectClaim, type SideEffectKey } from '@open333crm/core';
import { inTenant, type TenantScope } from '../../lib/tenant-ctx.js';

export interface BotReplyGuard {
  alreadyReplied(): Promise<boolean>;
  persist<T>(write: (tx: Prisma.TransactionClient, scope: TenantScope) => Promise<T | null>): Promise<T | null>;
}

const NOT_WRITTEN = Symbol('bot-reply-not-written');

/** 認領與寫入結果的交易失敗（沒有 commit）。呼叫端遇到它要往外丟，讓 job 重試 */
export class ClaimTransactionError extends Error {
  constructor(cause: unknown) {
    super(`認領的交易失敗：${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    this.name = 'ClaimTransactionError';
  }
}

/**
 * inboundMessageId 沒有值時（舊資料的事件）不認領，行為與加上認領之前相同。
 * tenantPrisma 是 inTenant() 的基礎連線；adminDb 用在交易外的檢查，查詢自帶 tenantId。
 */
export function createBotReplyGuard(
  tenantPrisma: PrismaClient,
  adminDb: Pick<PrismaClient, 'sideEffectClaim'>,
  tenantId: string,
  inboundMessageId: string | undefined,
): BotReplyGuard {
  const key: SideEffectKey | null = inboundMessageId ? { tenantId, kind: 'bot_reply', sourceId: inboundMessageId } : null;
  return {
    alreadyReplied: async () => (key ? hasSideEffectClaim(adminDb, key) : false),
    async persist(write) {
      try {
        return await inTenant(tenantPrisma, tenantId, async (scope) => {
          if (key && !(await claimSideEffect(scope.tx, key))) return null;
          const written = await write(scope.tx, scope);
          // 沒有寫入回覆：丟錯讓交易 rollback，認領紀錄不留下，之後的回覆仍可認領
          if (written === null) throw NOT_WRITTEN;
          return written;
        });
      } catch (err) {
        if (err === NOT_WRITTEN) return null;
        throw new ClaimTransactionError(err);
      }
    },
  };
}
