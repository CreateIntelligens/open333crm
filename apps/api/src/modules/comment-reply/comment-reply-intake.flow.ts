/**
 * webhook 呼叫的留言收件 flow（change add-comment-keyword-private-reply design「資料流」a～e、D3、D4、D9、D16、D22）。
 *
 * webhook 已驗簽並依 entry.id 分派到渠道（與私訊同一套），這裡對一個渠道的留言事件：
 *   a 平台緊急停止／私訊能力關閉 → 結束（不碰資料庫）
 *     租戶停用／方案不含 comment_reply／渠道停用 → 結束（不寫資料）
 *   b 讀啟用規則（快取）→ 比對 → 沒命中：結束
 *   c～e 每則命中的留言一個 inTenant() 交易：插入 PENDING 紀錄（ON CONFLICT DO NOTHING）、找或建聯絡人、
 *        enqueueJob（outbox，與紀錄同交易）
 * 刪除留言（verb=remove）一律處理（清空留言內容是個資保護，不看方案與開關）。
 *
 * 日誌只寫 ID 與數量，不寫留言內容、留言者名稱（spec「留言處理不把個資寫進工作與日誌」）。
 */
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import type { ParsedCommentEvent } from '@open333crm/channel-plugins';
import { logger } from '@open333crm/core';
import { inTenant } from '../../lib/tenant-ctx.js';
import { createOutboxPublisher, enqueueJob, type EventPublisher } from '../../events/outbox-publisher.js';
import { matchCommentRule } from './comment-reply-match.js';
import { checkPlatformSwitches, checkTenantEntitlement } from './comment-reply-entitlement.js';
import { readCommentReplyPlatformSettings } from './comment-reply-platform-settings.js';
import type { CommentReplyPlatform } from './comment-reply-entitlement.js';
import { getCachedRules } from './comment-reply-rule-cache.js';
import {
  hasCommentLog,
  insertPendingLog,
  isChannelActive,
  listActiveRulesForChannel,
  toIntakeRule,
  markCommentDeleted,
  resolveCommentAuthor,
  touchCommentAuthor,
  type IntakeRule,
} from './comment-reply-intake.service.js';
import {
  COMMENT_REPLY_JOB_DELIVER,
  COMMENT_REPLY_JOB_OPTIONS,
  COMMENT_REPLY_QUEUE,
  type CommentReplyJobData,
} from './comment-reply.types.js';

/** 最後收到留言事件的時間（D25）：health 排程在值變動時才同步到渠道設定，避免每則留言寫渠道列 */
export function lastCommentEventKey(channelId: string): string {
  return `cr:last-event:${channelId}`;
}
const LAST_EVENT_TTL_SECONDS = 30 * 24 * 3600;

export interface CommentIntakeDeps {
  /** app_tenant 連線（inTenant 用） */
  prisma: PrismaClient;
  /** 規則快取的版本號與最後事件時間；沒有時不用快取 */
  redis?: Pick<Redis, 'get' | 'set'>;
  events?: EventPublisher;
}

export interface CommentIntakeChannel {
  id: string;
  tenantId: string;
  channelType: string;
}

export interface CommentIntakeSummary {
  enqueued: number;
  unmatched: number;
  duplicates: number;
  removed: number;
  /** 整批沒有處理的原因（緊急停止、能力關閉、方案不含、租戶或渠道停用、沒有啟用規則） */
  skippedReason?: string;
}

/** 同一則留言已有紀錄：讓交易回滾，剛建的聯絡人與留言者一起撤銷 */
class DuplicateCommentError extends Error {
  constructor() {
    super('comment already recorded');
  }
}

export async function intakeCommentEvents(
  deps: CommentIntakeDeps,
  channel: CommentIntakeChannel,
  platform: CommentReplyPlatform,
  events: ParsedCommentEvent[],
): Promise<CommentIntakeSummary> {
  const summary: CommentIntakeSummary = { enqueued: 0, unmatched: 0, duplicates: 0, removed: 0 };
  if (events.length === 0) return summary;

  if (deps.redis) {
    await deps.redis
      .set(lastCommentEventKey(channel.id), String(Date.now()), 'EX', LAST_EVENT_TTL_SECONDS)
      .catch((err: unknown) => logger.warn('[comment-reply] 記錄最後留言事件時間失敗', { channelId: channel.id, error: String(err) }));
  }

  const removes = events.filter((e) => e.kind === 'remove');
  const adds = events.filter((e) => e.kind === 'add');

  if (removes.length > 0) {
    summary.removed = await inTenant(deps.prisma, channel.tenantId, async (scope) => {
      let n = 0;
      for (const e of removes) n += await markCommentDeleted(scope, channel.id, e.commentId, new Date());
      return n;
    });
  }
  if (adds.length === 0) return summary;

  const settings = await readCommentReplyPlatformSettings(deps.prisma);
  const switches = checkPlatformSwitches(settings, platform);
  if (!switches.ok) {
    summary.skippedReason = switches.reason;
    return summary;
  }

  // 前置檢查與讀規則：一個短交易
  const preflight = await inTenant(deps.prisma, channel.tenantId, async (scope) => {
    const entitlement = await checkTenantEntitlement(scope);
    if (!entitlement.ok) return { ok: false as const, reason: entitlement.reason };
    if (!(await isChannelActive(scope, channel.id))) return { ok: false as const, reason: 'CHANNEL_INACTIVE' };
    const rules = await getCachedRules(deps.redis, channel.id, async () => (await listActiveRulesForChannel(scope, channel.id)).map(toIntakeRule));
    return { ok: true as const, rules };
  });
  if (!preflight.ok) {
    summary.skippedReason = preflight.reason;
    return summary;
  }
  if (preflight.rules.length === 0) {
    summary.skippedReason = 'NO_ACTIVE_RULES';
    summary.unmatched = adds.length;
    return summary;
  }

  const publisher = deps.events ?? createOutboxPublisher(deps.prisma);
  for (const event of adds) {
    const hit = matchCommentRule<IntakeRule>(preflight.rules, { channelId: channel.id, postId: event.postId, text: event.text });
    if (!hit) {
      summary.unmatched += 1;
      continue;
    }
    const outcome = await intakeOne(deps, publisher, channel, event, hit.rule, hit.matchedKeywords);
    if (outcome === 'enqueued') summary.enqueued += 1;
    else summary.duplicates += 1;
  }

  logger.info('[comment-reply] 留言收件完成', { tenantId: channel.tenantId, channelId: channel.id, ...summary });
  return summary;
}

async function intakeOne(
  deps: CommentIntakeDeps,
  publisher: EventPublisher,
  channel: CommentIntakeChannel,
  event: ParsedCommentEvent,
  rule: IntakeRule,
  matchedKeywords: string[],
): Promise<'enqueued' | 'duplicate'> {
  try {
    return await inTenant(deps.prisma, channel.tenantId, async (scope) => {
      // 重投的快路徑：已有紀錄就不建聯絡人
      if (await hasCommentLog(scope, channel.id, event.commentId)) return 'duplicate' as const;
      const author = await resolveCommentAuthor(scope, channel, event);
      const logId = await insertPendingLog(scope, {
        channelId: channel.id,
        ruleId: rule.id,
        commentAuthorId: author.authorId,
        event,
        matchedKeywords,
        dedupeKey: rule.dedupePerCommenter ? `${rule.id}:${event.commenterId}` : null,
        publicReplyEnabled: rule.publicReplyEnabled,
      });
      // 並行的另一個請求先寫了同一則留言：回滾本交易（含剛建的聯絡人）
      if (!logId) throw new DuplicateCommentError();
      if (!author.createdNow) await touchCommentAuthor(scope, author.authorId, event.createdAt);
      const job: CommentReplyJobData = { tenantId: channel.tenantId, logId };
      await enqueueJob(scope, publisher, COMMENT_REPLY_QUEUE, COMMENT_REPLY_JOB_DELIVER, job, COMMENT_REPLY_JOB_OPTIONS);
      return 'enqueued' as const;
    });
  } catch (err) {
    if (err instanceof DuplicateCommentError) return 'duplicate';
    // 兩個交易同時插入同一個留言者／留言時，另一方的唯一鍵可能讓本交易失敗；重新判斷一次
    if (isUniqueViolation(err)) {
      return inTenant(deps.prisma, channel.tenantId, async (scope) =>
        (await hasCommentLog(scope, channel.id, event.commentId)) ? ('duplicate' as const) : Promise.reject(err),
      );
    }
    throw err;
  }
}

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; meta?: { code?: string } } | null;
  return e?.code === 'P2002' || (e?.code === 'P2010' && e.meta?.code === '23505');
}
