/**
 * 留言私訊消費者每一步的資料操作（change add-comment-keyword-private-reply design D8～D14、「資料流」步驟 0～6）。
 *
 * 全部收 TenantCtx，只做資料庫操作；交易邊界、Meta 呼叫、限流與重試由 comment-reply-delivery.flow.ts 編排。
 * 狀態轉換一律用條件更新（WHERE status = …）：同一筆紀錄的工作被執行兩次時，只有一次會成功。
 */
import type { Prisma } from '@prisma/client';
import type { MetaErrorInfo } from '@open333crm/channel-plugins';
import type { TenantCtx } from '../../lib/tenant-ctx.js';
import type { CommentPublicReplyReasonCode, CommentReplyReasonCode } from './comment-reply.types.js';

/** 停在 SENDING 超過這段時間視為上次送出途中中斷（D9） */
export const SENDING_STALE_MS = 2 * 60_000;

/** 消費者需要的紀錄、規則、渠道、留言者、素材 */
export async function loadDeliveryRecord(ctx: TenantCtx, logId: string) {
  return ctx.tx.commentReplyLog.findFirst({
    where: { id: logId, tenantId: ctx.tenantId },
    select: {
      id: true,
      channelId: true,
      ruleId: true,
      commentAuthorId: true,
      commentId: true,
      commenterId: true,
      commenterName: true,
      commenterUsername: true,
      commentCreatedAt: true,
      status: true,
      dedupeKey: true,
      quotaMonth: true,
      sendAttemptedAt: true,
      metaRateLimitHits: true,
      publicReplyStatus: true,
      rule: {
        select: {
          id: true,
          isActive: true,
          deletedAt: true,
          contentType: true,
          messageText: true,
          publicReplyEnabled: true,
          publicReplyTexts: true,
          material: {
            select: { id: true, channelType: true, contentType: true, isActive: true, body: true, variables: true },
          },
        },
      },
      channel: {
        select: { id: true, channelType: true, isActive: true, credentialsEncrypted: true, externalAccountId: true },
      },
    },
  });
}

export type DeliveryRecord = NonNullable<Awaited<ReturnType<typeof loadDeliveryRecord>>>;

/** 紀錄是否該由這次工作處理：PENDING，或停在 SENDING 超過 2 分鐘（當機復原） */
export function deliveryMode(log: Pick<DeliveryRecord, 'status' | 'sendAttemptedAt'>, now: Date): 'normal' | 'recovery' | null {
  if (log.status === 'PENDING') return 'normal';
  if (log.status === 'SENDING' && (!log.sendAttemptedAt || now.getTime() - log.sendAttemptedAt.getTime() >= SENDING_STALE_MS)) {
    return 'recovery';
  }
  return null;
}

/** 私訊沒送出時公開回覆的子狀態：有設定公開回覆就記 SKIPPED（PRIVATE_REPLY_NOT_SENT） */
function publicReplyNotSent(publicReplyStatus: string): Prisma.CommentReplyLogUpdateManyMutationInput {
  if (publicReplyStatus === 'NOT_CONFIGURED') return {};
  return { publicReplyStatus: 'SKIPPED', publicReplyReasonCode: 'PRIVATE_REPLY_NOT_SENT' };
}

/**
 * 送出前就結束（SKIPPED、EXPIRED）：只從 PENDING 轉換（復原中的 SENDING 不在送出前略過，見 flow）。
 * 回傳是否更新成功。
 */
export async function finishBeforeSend(
  ctx: TenantCtx,
  log: Pick<DeliveryRecord, 'id' | 'publicReplyStatus'>,
  status: 'SKIPPED' | 'EXPIRED',
  reasonCode: CommentReplyReasonCode,
): Promise<boolean> {
  const res = await ctx.tx.commentReplyLog.updateMany({
    where: { id: log.id, tenantId: ctx.tenantId, status: 'PENDING' },
    data: { status, reasonCode, nextAttemptAt: null, ...publicReplyNotSent(log.publicReplyStatus) },
  });
  return res.count > 0;
}

/** 限流排隊、Meta 限流、網路錯誤重試：紀錄維持（或退回）PENDING，記下一次嘗試的時間 */
export async function backToPending(
  ctx: TenantCtx,
  logId: string,
  input: { reasonCode: 'RATE_LIMIT_QUEUED' | null; nextAttemptAt: Date | null; metaRateLimitHit?: boolean; from: 'PENDING' | 'SENDING' },
): Promise<boolean> {
  const res = await ctx.tx.commentReplyLog.updateMany({
    where: { id: logId, tenantId: ctx.tenantId, status: input.from },
    data: {
      status: 'PENDING',
      reasonCode: input.reasonCode,
      nextAttemptAt: input.nextAttemptAt,
      ...(input.metaRateLimitHit ? { metaRateLimitHits: { increment: 1 } } : {}),
    },
  });
  return res.count > 0;
}

export type ClaimResult =
  | { kind: 'claimed'; quotaMonth: string | null }
  | { kind: 'duplicate'; holderLogId: string }
  | { kind: 'wait' }
  | { kind: 'quota_exceeded' }
  | { kind: 'gone' };

/** 認領時發現紀錄已不是預期狀態：讓交易回滾（含剛扣的額度） */
export class ClaimLostError extends Error {
  constructor() {
    super('comment reply log already claimed');
  }
}

/**
 * T1（design「資料流」步驟 3）：去重 → 月額度原子扣減 → PENDING→SENDING。
 * - 去重（D10）：規則開「每人一次」時，同一 dedupeKey 已有 SENT → 本筆 SKIPPED_DUPLICATE；有 SENDING → 延後再判斷。
 *   並行的兩筆同時通過檢查時，部分唯一索引讓後到的交易失敗，由 flow 重跑一次 T1。
 * - 額度（D11）：同一筆紀錄只扣一次（quotaMonth 已有值就不再扣）；超過上限 → SKIPPED/PLAN_QUOTA_EXCEEDED。
 * - 認領：條件更新；0 列表示別的工作已處理 → 丟 ClaimLostError 讓交易回滾，額度一併還原。
 */
export async function claimForSending(
  ctx: TenantCtx,
  log: Pick<DeliveryRecord, 'id' | 'dedupeKey' | 'quotaMonth' | 'publicReplyStatus'>,
  input: { mode: 'normal' | 'recovery'; month: string; monthlyLimit: number | null; now: Date },
): Promise<ClaimResult> {
  const { tx, tenantId } = ctx;

  if (input.mode === 'normal' && log.dedupeKey) {
    const holder = await tx.commentReplyLog.findFirst({
      where: { tenantId, dedupeKey: log.dedupeKey, status: { in: ['SENDING', 'SENT'] }, id: { not: log.id } },
      select: { id: true, status: true },
      orderBy: { createdAt: 'asc' },
    });
    if (holder?.status === 'SENT') {
      const res = await tx.commentReplyLog.updateMany({
        where: { id: log.id, tenantId, status: 'PENDING' },
        data: { status: 'SKIPPED_DUPLICATE', holderLogId: holder.id, reasonCode: null, nextAttemptAt: null, ...publicReplyNotSent(log.publicReplyStatus) },
      });
      return res.count > 0 ? { kind: 'duplicate', holderLogId: holder.id } : { kind: 'gone' };
    }
    if (holder) return { kind: 'wait' };
  }

  let quotaMonth = log.quotaMonth;
  if (input.mode === 'normal' && !quotaMonth) {
    if (!(await reserveMonthlyQuota(ctx, input.month, input.monthlyLimit))) {
      const res = await tx.commentReplyLog.updateMany({
        where: { id: log.id, tenantId, status: 'PENDING' },
        data: { status: 'SKIPPED', reasonCode: 'PLAN_QUOTA_EXCEEDED', nextAttemptAt: null, ...publicReplyNotSent(log.publicReplyStatus) },
      });
      return res.count > 0 ? { kind: 'quota_exceeded' } : { kind: 'gone' };
    }
    quotaMonth = input.month;
  }

  const staleBefore = new Date(input.now.getTime() - SENDING_STALE_MS);
  const res = await tx.commentReplyLog.updateMany({
    where:
      input.mode === 'normal'
        ? { id: log.id, tenantId, status: 'PENDING' }
        : { id: log.id, tenantId, status: 'SENDING', OR: [{ sendAttemptedAt: null }, { sendAttemptedAt: { lte: staleBefore } }] },
    data: {
      status: 'SENDING',
      sendAttemptedAt: input.now,
      attemptCount: { increment: 1 },
      quotaMonth,
      reasonCode: null,
      nextAttemptAt: null,
    },
  });
  if (res.count === 0) throw new ClaimLostError();
  return { kind: 'claimed', quotaMonth };
}

/** 月額度原子扣減：先確保有當月列，再「未達上限才 +1」；回傳是否扣到（D11） */
export async function reserveMonthlyQuota(ctx: TenantCtx, month: string, limit: number | null): Promise<boolean> {
  await ctx.tx.$executeRaw`
    INSERT INTO comment_reply_usages ("tenantId", month, "sentCount", "publicReplyCount", "updatedAt")
    VALUES (${ctx.tenantId}::uuid, ${month}, 0, 0, now())
    ON CONFLICT ("tenantId", month) DO NOTHING`;
  const rows = await ctx.tx.$queryRaw<Array<{ sentCount: number }>>`
    UPDATE comment_reply_usages
    SET "sentCount" = "sentCount" + 1, "updatedAt" = now()
    WHERE "tenantId" = ${ctx.tenantId}::uuid AND month = ${month}
      AND (${limit}::int IS NULL OR "sentCount" < ${limit}::int)
    RETURNING "sentCount"`;
  return rows.length > 0;
}

/** 還名額（Meta 明確拒絕時）：扣回該月份的計數、清空紀錄的 quotaMonth */
async function refundQuota(ctx: TenantCtx, logId: string, quotaMonth: string | null): Promise<void> {
  if (!quotaMonth) return;
  await ctx.tx.$executeRaw`
    UPDATE comment_reply_usages
    SET "sentCount" = GREATEST("sentCount" - 1, 0), "updatedAt" = now()
    WHERE "tenantId" = ${ctx.tenantId}::uuid AND month = ${quotaMonth}`;
  await ctx.tx.commentReplyLog.updateMany({ where: { id: logId, tenantId: ctx.tenantId }, data: { quotaMonth: null } });
}

/** T2 成功：SENT，記 recipient_id、message_id、送出時間、內容快照（D9；復原時 Meta 回已私訊過 → SENT_UNCONFIRMED） */
export async function markSent(
  ctx: TenantCtx,
  logId: string,
  input: { recipientUid: string | null; messageId: string | null; snapshot: unknown; at: Date; unconfirmed?: boolean },
): Promise<boolean> {
  const res = await ctx.tx.commentReplyLog.updateMany({
    where: { id: logId, tenantId: ctx.tenantId, status: 'SENDING' },
    data: {
      status: 'SENT',
      reasonCode: input.unconfirmed ? 'SENT_UNCONFIRMED' : null,
      sentAt: input.at,
      recipientUid: input.recipientUid,
      sentMessageId: input.messageId,
      sentContentSnapshot: input.snapshot === undefined ? undefined : (input.snapshot as Prisma.InputJsonValue),
      nextAttemptAt: null,
    },
  });
  return res.count > 0;
}

/** Meta 錯誤的原始資訊（訊息前 200 字） */
function metaErrorFields(error: MetaErrorInfo | undefined): Prisma.CommentReplyLogUpdateManyMutationInput {
  if (!error) return {};
  return {
    reasonMessage: error.message ? error.message.slice(0, 200) : null,
    metaErrorCode: error.code ?? null,
    metaErrorSubcode: error.subcode ?? null,
    metaTraceId: error.traceId ?? null,
  };
}

/**
 * T2 失敗：FAILED 或 EXPIRED（Meta 回超過期限）。refund 為 true 時同一交易還名額（Meta 明確拒絕，D11）。
 * 公開回覆一併記 SKIPPED（私訊沒送出就不公開回覆）。
 */
export async function markSendFailed(
  ctx: TenantCtx,
  log: Pick<DeliveryRecord, 'id' | 'publicReplyStatus'> & { quotaMonth: string | null },
  input: { status: 'FAILED' | 'EXPIRED'; reasonCode: CommentReplyReasonCode; error?: MetaErrorInfo; refund: boolean },
): Promise<boolean> {
  const res = await ctx.tx.commentReplyLog.updateMany({
    where: { id: log.id, tenantId: ctx.tenantId, status: 'SENDING' },
    data: {
      status: input.status,
      reasonCode: input.reasonCode,
      nextAttemptAt: null,
      ...metaErrorFields(input.error),
      ...publicReplyNotSent(log.publicReplyStatus),
    },
  });
  if (res.count > 0 && input.refund) await refundQuota(ctx, log.id, log.quotaMonth);
  return res.count > 0;
}

/** Meta 錯誤的原始資訊記在 PENDING 紀錄上（網路錯誤重試、Meta 限流），後台詳情看得到最後一次錯誤 */
export async function recordLastError(ctx: TenantCtx, logId: string, error: MetaErrorInfo): Promise<void> {
  await ctx.tx.commentReplyLog.updateMany({ where: { id: logId, tenantId: ctx.tenantId }, data: metaErrorFields(error) });
}

// ── 公開回覆（D8、spec「公開回覆留言」）─────────────────────────────

/** 不送公開回覆：記 SKIPPED 與原因（只從 PENDING） */
export async function skipPublicReply(ctx: TenantCtx, logId: string, reasonCode: CommentPublicReplyReasonCode): Promise<void> {
  await ctx.tx.commentReplyLog.updateMany({
    where: { id: logId, tenantId: ctx.tenantId, publicReplyStatus: 'PENDING' },
    data: { publicReplyStatus: 'SKIPPED', publicReplyReasonCode: reasonCode },
  });
}

/** T3：公開回覆 PENDING→SENDING；回傳是否認領成功 */
export async function claimPublicReply(ctx: TenantCtx, logId: string, text: string): Promise<boolean> {
  const res = await ctx.tx.commentReplyLog.updateMany({
    where: { id: logId, tenantId: ctx.tenantId, status: 'SENT', publicReplyStatus: 'PENDING' },
    data: { publicReplyStatus: 'SENDING', publicReplyText: text },
  });
  return res.count > 0;
}

/** T4：公開回覆結果；成功時累計當月 publicReplyCount（不設上限） */
export async function markPublicReply(
  ctx: TenantCtx,
  logId: string,
  input: { ok: true; replyId: string; at: Date; month: string } | { ok: false; reasonCode: CommentPublicReplyReasonCode },
): Promise<void> {
  if (input.ok) {
    const res = await ctx.tx.commentReplyLog.updateMany({
      where: { id: logId, tenantId: ctx.tenantId, publicReplyStatus: 'SENDING' },
      data: { publicReplyStatus: 'SENT', publicReplyCommentId: input.replyId, publicReplyAt: input.at, publicReplyReasonCode: null },
    });
    if (res.count > 0) {
      await ctx.tx.$executeRaw`
        INSERT INTO comment_reply_usages ("tenantId", month, "sentCount", "publicReplyCount", "updatedAt")
        VALUES (${ctx.tenantId}::uuid, ${input.month}, 0, 1, now())
        ON CONFLICT ("tenantId", month) DO UPDATE SET "publicReplyCount" = comment_reply_usages."publicReplyCount" + 1, "updatedAt" = now()`;
    }
    return;
  }
  await ctx.tx.commentReplyLog.updateMany({
    where: { id: logId, tenantId: ctx.tenantId, publicReplyStatus: 'SENDING' },
    data: { publicReplyStatus: 'FAILED', publicReplyReasonCode: input.reasonCode },
  });
}

/** 復原時公開回覆停在 SENDING：公開回覆不冪等，不重送，記 FAILED/UNKNOWN_AFTER_CRASH */
export async function failStalePublicReply(ctx: TenantCtx, logId: string): Promise<void> {
  await ctx.tx.commentReplyLog.updateMany({
    where: { id: logId, tenantId: ctx.tenantId, publicReplyStatus: 'SENDING' },
    data: { publicReplyStatus: 'FAILED', publicReplyReasonCode: 'UNKNOWN_AFTER_CRASH' },
  });
}

/** 寫 SENT 之後要用的紀錄欄位（公開回覆、收件匣串接） */
export async function loadSentLog(ctx: TenantCtx, logId: string) {
  return ctx.tx.commentReplyLog.findFirst({
    where: { id: logId, tenantId: ctx.tenantId },
    select: { id: true, status: true, publicReplyStatus: true, recipientUid: true, sentAt: true, channelId: true },
  });
}
