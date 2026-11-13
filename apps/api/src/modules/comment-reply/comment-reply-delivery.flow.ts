/**
 * 留言私訊的消費者主流程（change add-comment-keyword-private-reply design「資料流」步驟 0～6、D9～D14、D16-4、D18）。
 *
 *   0 讀紀錄（短交易）；不是 PENDING／逾時 SENDING → 結束
 *   1 再檢查：租戶、緊急停止、能力、方案、渠道、7 天、規則、素材 → 不送：SKIPPED／EXPIRED
 *   2 私訊 bucket（Redis）→ 沒有 token：PENDING＋RATE_LIMIT_QUEUED，job 延後（不消耗重試次數）
 *   3 T1：去重 → 扣月額度 → PENDING→SENDING
 *   4 交易外：sendPrivateReply()
 *   5 T2：SENT＋接上身分／FAILED（明確拒絕還名額）／退回 PENDING 重試
 *   6 交易外：公開回覆（T3 認領 → replyToComment() → T4）；顧客已先回覆 → attachCommentOrigin
 *
 * 呼叫 Meta 的期間不持有資料庫交易（AGENTS.md 結構規則 2）。業務失敗寫進紀錄後正常結束；
 * 只有資料庫或程式例外往外丟，讓 BullMQ 重試、用盡後進 failed set 發告警（D13）。
 */
import type { PrismaClient } from '@prisma/client';
import { getChannelPlugin, type ChannelPlugin, type MetaErrorInfo } from '@open333crm/channel-plugins';
import { logger, taipeiMonthString } from '@open333crm/core';
import { inTenant } from '../../lib/tenant-ctx.js';
import { decryptCredentials } from '../channel/channel.service.js';
import { getEffectiveLimit } from '../platform/plan-limits.service.js';
import { checkCommentReplyEntitlement } from './comment-reply-entitlement.js';
import { isCommentReplyWindowExpired } from './comment-reply-expiry.js';
import { commenterDisplayName, pickPublicReplyText, renderCommentReplyContent } from './comment-reply-content.js';
import {
  capabilityName,
  readCommentReplyPlatformSettings,
  type CommentReplyPlatformSettings,
} from './comment-reply-platform-settings.js';
import type { RateGate } from './comment-reply-rate-gate.js';
import {
  backToPending,
  claimForSending,
  claimPublicReply,
  ClaimLostError,
  deliveryMode,
  failStalePublicReply,
  finishBeforeSend,
  loadDeliveryRecord,
  markPublicReply,
  markSendFailed,
  markSent,
  recordLastError,
  skipPublicReply,
  type DeliveryRecord,
} from './comment-reply-delivery.service.js';
import { linkRecipientIdentity } from './comment-reply-contact.service.js';
import { attachCommentOrigin, findConversationRepliedAfter } from './comment-reply-inbox.service.js';
import type { CommentReplyReasonCode } from './comment-reply.types.js';

/** 去重持有者還在送出中：延後再判斷（D10） */
export const DEDUPE_WAIT_MS = 30_000;
/** Meta 回限流但沒有給恢復時間時，暫停該渠道的時間 */
export const META_RATE_LIMIT_DEFAULT_PAUSE_MS = 60_000;
/** 同一筆紀錄累計這麼多次 Meta 限流回應 → FAILED/RATE_LIMITED（D12） */
export const META_RATE_LIMIT_MAX_HITS = 10;

/** Meta 明確拒絕（沒有送達）：還名額（D11） */
const REFUND_REASONS = new Set<string>([
  'USER_UNAVAILABLE',
  'COMMENT_NOT_FOUND',
  'RECIPIENT_IS_PAGE',
  'ALREADY_REPLIED',
  'PERMISSION_MISSING',
  'APP_NOT_APPROVED',
  'TOKEN_EXPIRED',
  'EXPIRED_BY_META',
  'RATE_LIMITED',
  'MATERIAL_UNSUPPORTED',
]);

export interface CommentReplyDeliveryDeps {
  /** app_tenant 連線（inTenant 用） */
  prisma: PrismaClient;
  rateGate: RateGate;
  /** 測試可替換外掛 */
  plugins?: (channelType: string) => ChannelPlugin | undefined;
  now?: () => Date;
}

/** 這次執行是第幾次（BullMQ 的 attemptsMade）與總次數（job.opts.attempts） */
export interface DeliveryAttempt {
  attemptsMade: number;
  attempts: number;
}

export type DeliveryOutcome =
  | { kind: 'done'; status: string; reasonCode?: string | null }
  | { kind: 'gone' }
  /** job 延後到 at（限流、去重持有者送出中）：不消耗重試次數 */
  | { kind: 'delay'; until: number; reason: 'RATE_LIMIT_QUEUED' | 'DEDUPE_WAIT' | 'META_RATE_LIMITED' }
  /** 網路錯誤：讓 BullMQ 退避重試（會消耗重試次數） */
  | { kind: 'retry'; message: string };

export async function deliverCommentReply(
  deps: CommentReplyDeliveryDeps,
  tenantId: string,
  logId: string,
  attempt: DeliveryAttempt,
): Promise<DeliveryOutcome> {
  const now = () => deps.now?.() ?? new Date();
  const started = now();

  // 0 讀紀錄
  const log = await inTenant(deps.prisma, tenantId, (ctx) => loadDeliveryRecord(ctx, logId));
  if (!log) return { kind: 'gone' };
  const mode = deliveryMode(log, started);
  if (!mode) return { kind: 'gone' };

  const plugin = (deps.plugins ?? getChannelPlugin)(log.channel.channelType);
  const ext = plugin?.extensions?.comments;
  const settings = await readCommentReplyPlatformSettings(deps.prisma);

  // 1 送出前重新檢查（只對 PENDING；復原中的 SENDING 可能已送達，直接再送一次交給 Meta 判斷）
  let payload: ReturnType<typeof renderCommentReplyContent> | null = null;
  if (mode === 'normal') {
    const skip = await precheck(deps, tenantId, log, ext, settings, started);
    if (skip) return skip;
  }
  if (!ext) return finish(deps, tenantId, log, 'SKIPPED', 'CHANNEL_INACTIVE');
  payload = renderCommentReplyContent({
    content:
      log.rule.contentType === 'material'
        ? { type: 'material', material: log.rule.material }
        : { type: 'text', text: log.rule.messageText ?? '' },
    commenter: { name: commenterDisplayName(log) },
    capabilities: ext.capabilities,
  });
  if (!payload.ok) {
    if (mode === 'normal') return finish(deps, tenantId, log, 'SKIPPED', payload.reason);
    return failRecovered(deps, tenantId, log, payload.reason);
  }

  const platform = ext.capabilities.platform;

  // 2 私訊 bucket
  const token = await deps.rateGate.take('pm', log.channelId, platform === 'fb' ? settings.rateLimits.fbPerHour : settings.rateLimits.igPerHour, started.getTime());
  if (!token.ok) {
    const until = started.getTime() + token.retryAfterMs;
    if (mode === 'normal') {
      await inTenant(deps.prisma, tenantId, (ctx) =>
        backToPending(ctx, log.id, { reasonCode: 'RATE_LIMIT_QUEUED', nextAttemptAt: new Date(until), from: 'PENDING' }),
      );
    }
    return { kind: 'delay', until, reason: 'RATE_LIMIT_QUEUED' };
  }

  // 3 T1：去重、額度、認領
  const monthlyLimit = await inTenant(deps.prisma, tenantId, (ctx) => getEffectiveLimit(ctx.tx, tenantId, 'monthlyCommentReplies'));
  const claim = await claimWithRetry(deps, tenantId, log, { mode, month: taipeiMonthString(started), monthlyLimit, now: started });
  switch (claim.kind) {
    case 'gone':
      return { kind: 'gone' };
    case 'wait':
      return { kind: 'delay', until: started.getTime() + DEDUPE_WAIT_MS, reason: 'DEDUPE_WAIT' };
    case 'duplicate':
      return { kind: 'done', status: 'SKIPPED_DUPLICATE' };
    case 'quota_exceeded':
      return { kind: 'done', status: 'SKIPPED', reasonCode: 'PLAN_QUOTA_EXCEEDED' };
    case 'claimed':
      break;
  }
  const quotaMonth = claim.quotaMonth;

  // 4 交易外呼叫 Meta
  const credentials = decryptCredentials(log.channel.credentialsEncrypted);
  const result = await ext.sendPrivateReply(log.commentId, payload.payload, credentials);
  const at = now();

  // 5 T2
  if (result.ok) {
    await inTenant(deps.prisma, tenantId, async (ctx) => {
      const ok = await markSent(ctx, log.id, {
        recipientUid: result.recipientId,
        messageId: result.messageId,
        snapshot: payload.ok ? payload.payload : undefined,
        at,
      });
      if (ok && result.recipientId) {
        await linkRecipientIdentity(ctx, {
          channel: log.channel,
          commentAuthorId: log.commentAuthorId,
          recipientUid: result.recipientId,
          commenterId: log.commenterId,
        });
      }
    });
    await afterSent(deps, tenantId, log, ext, settings, credentials, at, mode);
    return { kind: 'done', status: 'SENT' };
  }

  return handleSendError(deps, tenantId, log, result.error, { mode, quotaMonth, attempt, settings, platform, credentials, at });
}

/** 步驟 1 的再檢查；不送時寫終態並回傳結果 */
async function precheck(
  deps: CommentReplyDeliveryDeps,
  tenantId: string,
  log: DeliveryRecord,
  ext: NonNullable<ChannelPlugin['extensions']>['comments'],
  settings: CommentReplyPlatformSettings,
  now: Date,
): Promise<DeliveryOutcome | null> {
  if (!log.channel.isActive || !ext) return finish(deps, tenantId, log, 'SKIPPED', 'CHANNEL_INACTIVE');
  const entitlement = await inTenant(deps.prisma, tenantId, (ctx) =>
    checkCommentReplyEntitlement(ctx, settings, ext.capabilities.platform),
  );
  if (!entitlement.ok) return finish(deps, tenantId, log, 'SKIPPED', entitlement.reason);
  if (isCommentReplyWindowExpired(log.commentCreatedAt, now)) return finish(deps, tenantId, log, 'EXPIRED', 'WINDOW_EXPIRED');
  if (!log.rule.isActive || log.rule.deletedAt) return finish(deps, tenantId, log, 'SKIPPED', 'RULE_INACTIVE');
  return null;
}

async function finish(
  deps: CommentReplyDeliveryDeps,
  tenantId: string,
  log: DeliveryRecord,
  status: 'SKIPPED' | 'EXPIRED',
  reasonCode: CommentReplyReasonCode,
): Promise<DeliveryOutcome> {
  const ok = await inTenant(deps.prisma, tenantId, (ctx) => finishBeforeSend(ctx, log, status, reasonCode));
  return ok ? { kind: 'done', status, reasonCode } : { kind: 'gone' };
}

/** 復原中的紀錄已在 SENDING：內容無法渲染時直接記失敗（不會再送） */
async function failRecovered(
  deps: CommentReplyDeliveryDeps,
  tenantId: string,
  log: DeliveryRecord,
  reasonCode: CommentReplyReasonCode,
): Promise<DeliveryOutcome> {
  await inTenant(deps.prisma, tenantId, (ctx) =>
    markSendFailed(ctx, log, { status: 'FAILED', reasonCode, refund: false }),
  );
  return { kind: 'done', status: 'FAILED', reasonCode };
}

/**
 * T1；並行的另一筆同時認領同一個去重鍵時，部分唯一索引讓本交易失敗（交易已無法繼續），重跑一次會看到持有者。
 */
async function claimWithRetry(
  deps: CommentReplyDeliveryDeps,
  tenantId: string,
  log: DeliveryRecord,
  input: Parameters<typeof claimForSending>[2],
) {
  for (let i = 0; ; i++) {
    try {
      return await inTenant(deps.prisma, tenantId, (ctx) => claimForSending(ctx, log, input));
    } catch (err) {
      if (err instanceof ClaimLostError) return { kind: 'gone' as const };
      if (i === 0 && isUniqueViolation(err)) continue;
      throw err;
    }
  }
}

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; meta?: { code?: string } } | null;
  return e?.code === 'P2002' || (e?.code === 'P2010' && e.meta?.code === '23505');
}

interface ErrorContext {
  mode: 'normal' | 'recovery';
  quotaMonth: string | null;
  attempt: DeliveryAttempt;
  settings: CommentReplyPlatformSettings;
  platform: 'fb' | 'ig';
  credentials: Record<string, unknown>;
  at: Date;
}

/** 步驟 5 的失敗分類（D9、D11、D12、D13、D22 測試階段） */
async function handleSendError(
  deps: CommentReplyDeliveryDeps,
  tenantId: string,
  log: DeliveryRecord,
  error: MetaErrorInfo,
  c: ErrorContext,
): Promise<DeliveryOutcome> {
  const failed = { ...log, quotaMonth: c.quotaMonth };

  // 當機復原：Meta 回已私訊過 → 上次其實送達了（每則留言只允許一次私訊）
  if (error.reason === 'ALREADY_REPLIED' && c.mode === 'recovery') {
    await inTenant(deps.prisma, tenantId, (ctx) =>
      markSent(ctx, log.id, { recipientUid: null, messageId: null, snapshot: undefined, at: c.at, unconfirmed: true }),
    );
    await inTenant(deps.prisma, tenantId, (ctx) => failStalePublicReply(ctx, log.id));
    return { kind: 'done', status: 'SENT', reasonCode: 'SENT_UNCONFIRMED' };
  }

  if (error.reason === 'RATE_LIMITED') {
    const hits = log.metaRateLimitHits + 1;
    if (hits >= META_RATE_LIMIT_MAX_HITS) {
      await inTenant(deps.prisma, tenantId, async (ctx) => {
        await ctx.tx.commentReplyLog.updateMany({ where: { id: log.id, tenantId }, data: { metaRateLimitHits: hits } });
        await markSendFailed(ctx, failed, { status: 'FAILED', reasonCode: 'RATE_LIMITED', error, refund: true });
      });
      return { kind: 'done', status: 'FAILED', reasonCode: 'RATE_LIMITED' };
    }
    const pauseMs = error.retryAfterMs ?? META_RATE_LIMIT_DEFAULT_PAUSE_MS;
    await deps.rateGate.pause('pm', log.channelId, pauseMs, c.at.getTime());
    const until = c.at.getTime() + pauseMs;
    await inTenant(deps.prisma, tenantId, async (ctx) => {
      await backToPending(ctx, log.id, { reasonCode: 'RATE_LIMIT_QUEUED', nextAttemptAt: new Date(until), metaRateLimitHit: true, from: 'SENDING' });
      await recordLastError(ctx, log.id, error);
    });
    return { kind: 'delay', until, reason: 'META_RATE_LIMITED' };
  }

  if (error.transient) {
    // 網路錯誤、5xx：還有重試次數 → 退回 PENDING 讓 BullMQ 退避重試（額度保留，同一筆不重扣）
    if (c.attempt.attemptsMade < c.attempt.attempts - 1) {
      await inTenant(deps.prisma, tenantId, async (ctx) => {
        await backToPending(ctx, log.id, { reasonCode: null, nextAttemptAt: null, from: 'SENDING' });
        await recordLastError(ctx, log.id, error);
      });
      return { kind: 'retry', message: `comment reply send failed (${error.reason})` };
    }
    // 最後一次：不確定是否送達，不還名額
    await inTenant(deps.prisma, tenantId, (ctx) => markSendFailed(ctx, failed, { status: 'FAILED', reasonCode: 'NETWORK', error, refund: false }));
    return { kind: 'done', status: 'FAILED', reasonCode: 'NETWORK' };
  }

  let reasonCode: CommentReplyReasonCode;
  let status: 'FAILED' | 'EXPIRED' = 'FAILED';
  if (error.reason === 'EXPIRED_BY_META') {
    status = 'EXPIRED';
    reasonCode = 'EXPIRED_BY_META';
  } else if (error.reason === 'MATERIAL_UNSUPPORTED') {
    reasonCode = 'UNKNOWN';
  } else if (error.reason === 'PERMISSION_MISSING' && isTestPhasePlatformChannel(c)) {
    // 審核前（Standard Access）平台模式渠道的權限錯誤，多半是對象不在 App 角色內（D22）
    reasonCode = 'APP_NOT_APPROVED';
  } else {
    reasonCode = error.reason as CommentReplyReasonCode;
  }
  const refund = REFUND_REASONS.has(reasonCode) || REFUND_REASONS.has(error.reason);
  await inTenant(deps.prisma, tenantId, (ctx) => markSendFailed(ctx, failed, { status, reasonCode, error, refund }));
  logger.warn('[comment-reply] 私訊被 Meta 拒絕', { tenantId, logId: log.id, reasonCode, metaCode: error.code ?? null });
  return { kind: 'done', status, reasonCode };
}

function isTestPhasePlatformChannel(c: ErrorContext): boolean {
  return c.credentials.connectMode === 'platform' && c.settings.testPhase[c.platform];
}

/** 步驟 6：公開回覆、顧客已先回覆時的收件匣串接。失敗只記 log（私訊已送出，不改主狀態） */
async function afterSent(
  deps: CommentReplyDeliveryDeps,
  tenantId: string,
  log: DeliveryRecord,
  ext: NonNullable<NonNullable<ChannelPlugin['extensions']>['comments']>,
  settings: CommentReplyPlatformSettings,
  credentials: Record<string, unknown>,
  sentAt: Date,
  mode: 'normal' | 'recovery',
): Promise<void> {
  try {
    if (log.rule.publicReplyEnabled && log.publicReplyStatus !== 'NOT_CONFIGURED') {
      await sendPublicReply(deps, tenantId, log, ext, settings, credentials, mode);
    }
  } catch (err) {
    logger.error('[comment-reply] 公開回覆處理失敗', { tenantId, logId: log.id, error: err instanceof Error ? err.message : String(err) });
  }
  try {
    await inTenant(deps.prisma, tenantId, async (ctx) => {
      const sent = await ctx.tx.commentReplyLog.findFirst({
        where: { id: log.id, tenantId },
        select: { recipientUid: true, conversationId: true },
      });
      if (!sent?.recipientUid || sent.conversationId) return;
      const replied = await findConversationRepliedAfter(ctx, { channelId: log.channelId, uid: sent.recipientUid, sentAt });
      if (replied) {
        await attachCommentOrigin(ctx, {
          channelId: log.channelId,
          uid: sent.recipientUid,
          conversationId: replied.conversationId,
          repliedAt: replied.repliedAt,
        });
      }
    });
  } catch (err) {
    logger.error('[comment-reply] 收件匣串接失敗', { tenantId, logId: log.id, error: err instanceof Error ? err.message : String(err) });
  }
}

async function sendPublicReply(
  deps: CommentReplyDeliveryDeps,
  tenantId: string,
  log: DeliveryRecord,
  ext: NonNullable<NonNullable<ChannelPlugin['extensions']>['comments']>,
  settings: CommentReplyPlatformSettings,
  credentials: Record<string, unknown>,
  mode: 'normal' | 'recovery',
): Promise<void> {
  if (mode === 'recovery' && log.publicReplyStatus === 'SENDING') {
    await inTenant(deps.prisma, tenantId, (ctx) => failStalePublicReply(ctx, log.id));
    return;
  }
  const platform = ext.capabilities.platform;
  if (!settings.capabilities[capabilityName(platform, 'PublicReply')] || !ext.capabilities.publicReply) {
    await inTenant(deps.prisma, tenantId, (ctx) => skipPublicReply(ctx, log.id, 'CAPABILITY_DISABLED'));
    return;
  }
  const text = pickPublicReplyText(log.rule.publicReplyTexts, log.commentId);
  if (!text) {
    await inTenant(deps.prisma, tenantId, (ctx) => skipPublicReply(ctx, log.id, 'CAPABILITY_DISABLED'));
    return;
  }
  const token = await deps.rateGate.take('pr', log.channelId, settings.rateLimits.publicReplyPerHour);
  if (!token.ok) {
    await inTenant(deps.prisma, tenantId, (ctx) => skipPublicReply(ctx, log.id, 'RATE_LIMITED'));
    return;
  }
  const claimed = await inTenant(deps.prisma, tenantId, (ctx) => claimPublicReply(ctx, log.id, text));
  if (!claimed) return;
  const res = await ext.replyToComment(log.commentId, text, credentials);
  const at = deps.now?.() ?? new Date();
  await inTenant(deps.prisma, tenantId, (ctx) =>
    markPublicReply(
      ctx,
      log.id,
      res.ok
        ? { ok: true, replyId: res.replyId, at, month: taipeiMonthString(at) }
        : { ok: false, reasonCode: publicReplyReason(res.error) },
    ),
  );
}

function publicReplyReason(error: MetaErrorInfo): 'RATE_LIMITED' | 'PERMISSION_MISSING' | 'UNKNOWN' {
  if (error.reason === 'RATE_LIMITED') return 'RATE_LIMITED';
  if (error.reason === 'PERMISSION_MISSING' || error.reason === 'TOKEN_EXPIRED') return 'PERMISSION_MISSING';
  return 'UNKNOWN';
}
