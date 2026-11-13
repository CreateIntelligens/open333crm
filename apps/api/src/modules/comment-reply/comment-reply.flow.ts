/**
 * 留言自動私訊後台 API 的 flow（change add-comment-keyword-private-reply design「API」、D19、D24；AGENTS.md 結構規則 2）。
 *
 * - 交易：inTenant() 開租戶交易，service 只收 TenantCtx；稽核與資料同一交易寫入（寫入失敗一起 rollback）。
 * - Meta 呼叫（readiness、留言接收開關、最近貼文、網址解析）一律在交易外：先短交易讀渠道，交易外呼叫外掛，
 *   成功後再開交易寫結果與稽核（design D1）。
 * - 規則異動 commit 後遞增 Redis 版本號 `cr:rules-ver:<channelId>`，讓收件端 30 秒的規則快取失效（design D4）。
 * - 重試：紀錄改回 PENDING 與 outbox 排入同一交易（requeueCommentReplyLog），job 名稱與收件相同。
 */
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import { logger } from '@open333crm/core';
import { createOutboxPublisher, enqueueJob, type EventPublisher } from '../../events/outbox-publisher.js';
import type { RequestActor } from '../../lib/request-actor.js';
import { inTenant, type TenantCtx, type TenantScope } from '../../lib/tenant-ctx.js';
import { recordTenantAudit } from '../tenant-audit/tenant-audit.service.js';
import type { CommentReplyViewer } from './comment-reply-access.js';
import {
  buildReadiness,
  commentSubscriptionFields,
  listRecentPostsMeta,
  loadCommentChannel,
  loadReadinessBase,
  readinessCacheKey,
  resolvePostUrlMeta,
  assertPostPickerCapability,
  saveCommentSubscription,
  subscribeCommentFieldsMeta,
} from './comment-reply-channel.service.js';
import { getLog, listLogs, markLogForRetry, summarizeLogs } from './comment-reply-log.service.js';
import { readCommentReplyPlatformSettings } from './comment-reply-platform-settings.js';
import {
  commentReplyRulesVersionKey,
  createRule,
  deleteRule,
  getRule,
  listMaterialOptions,
  listRules,
  reorderRules,
  setRuleActive,
  testRules,
  updateRule,
} from './comment-reply-rule.service.js';
import type { LogsQuery, RuleInput, RulePatch } from './comment-reply.schemas.js';
import { COMMENT_REPLY_JOB_DELIVER, COMMENT_REPLY_QUEUE } from './comment-reply.types.js';

export interface CommentReplyFlowDeps {
  prisma: PrismaClient;
  /** 規則快取版本號、readiness 與最近貼文的快取；沒有時不快取 */
  redis?: Redis;
  /** 測試注入；預設寫 outbox 後以快路徑送進佇列 */
  events?: EventPublisher;
}

/** 佇列 job 的選項（design D1）：attempts 5、指數退避 10 秒 */
export const COMMENT_REPLY_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 10_000 },
  removeOnComplete: { age: 86_400 },
  removeOnFail: { age: 604_800 },
} as const;

function bumpRulesVersion(scope: TenantScope, deps: CommentReplyFlowDeps, channelIds: string[]) {
  const redis = deps.redis;
  if (!redis || channelIds.length === 0) return;
  scope.afterCommit('comment-reply rules version', async () => {
    await Promise.all(channelIds.map((id) => redis.incr(commentReplyRulesVersionKey(id))));
  });
}

const tx = <T>(deps: CommentReplyFlowDeps, tenantId: string, fn: (scope: TenantScope) => Promise<T>) => inTenant(deps.prisma, tenantId, fn);

// ─── 規則 ────────────────────────────────────────────────────────────────

export const listRulesFlow = (deps: CommentReplyFlowDeps, actor: RequestActor, viewer: CommentReplyViewer, filter: { channelId?: string }) =>
  tx(deps, actor.tenantId, (s) => listRules(s, viewer, filter));

export const getRuleFlow = (deps: CommentReplyFlowDeps, actor: RequestActor, viewer: CommentReplyViewer, id: string) =>
  tx(deps, actor.tenantId, (s) => getRule(s, viewer, id));

export function createRuleFlow(deps: CommentReplyFlowDeps, actor: RequestActor, viewer: CommentReplyViewer, input: RuleInput) {
  return tx(deps, actor.tenantId, async (scope) => {
    const settings = await readCommentReplyPlatformSettings(scope.tx);
    const { view, channelId } = await createRule(scope, viewer, input, { settings });
    await recordTenantAudit(scope, {
      actorId: actor.agentId,
      action: 'comment_reply.rule.create',
      targetType: 'comment_reply_rule',
      targetId: view.id,
      payload: { name: view.name, channelId, isActive: view.isActive, contentType: view.content.type },
      ip: actor.ip,
    });
    bumpRulesVersion(scope, deps, [channelId]);
    return view;
  });
}

export function updateRuleFlow(deps: CommentReplyFlowDeps, actor: RequestActor, viewer: CommentReplyViewer, id: string, patch: RulePatch) {
  return tx(deps, actor.tenantId, async (scope) => {
    const settings = await readCommentReplyPlatformSettings(scope.tx);
    const { view, channelId, changedFields } = await updateRule(scope, viewer, id, patch, { settings });
    await recordTenantAudit(scope, {
      actorId: actor.agentId,
      action: 'comment_reply.rule.update',
      targetType: 'comment_reply_rule',
      targetId: view.id,
      payload: { name: view.name, channelId, fields: changedFields },
      ip: actor.ip,
    });
    bumpRulesVersion(scope, deps, [channelId]);
    return view;
  });
}

export function setRuleActiveFlow(deps: CommentReplyFlowDeps, actor: RequestActor, viewer: CommentReplyViewer, id: string, isActive: boolean) {
  return tx(deps, actor.tenantId, async (scope) => {
    const { view, channelId } = await setRuleActive(scope, viewer, id, isActive);
    await recordTenantAudit(scope, {
      actorId: actor.agentId,
      action: 'comment_reply.rule.toggle',
      targetType: 'comment_reply_rule',
      targetId: view.id,
      payload: { name: view.name, channelId, isActive },
      ip: actor.ip,
    });
    bumpRulesVersion(scope, deps, [channelId]);
    return view;
  });
}

export function deleteRuleFlow(deps: CommentReplyFlowDeps, actor: RequestActor, viewer: CommentReplyViewer, id: string) {
  return tx(deps, actor.tenantId, async (scope) => {
    const deleted = await deleteRule(scope, viewer, id);
    await recordTenantAudit(scope, {
      actorId: actor.agentId,
      action: 'comment_reply.rule.delete',
      targetType: 'comment_reply_rule',
      targetId: deleted.id,
      payload: { name: deleted.name, channelId: deleted.channelId },
      ip: actor.ip,
    });
    bumpRulesVersion(scope, deps, [deleted.channelId]);
  });
}

export function reorderRulesFlow(deps: CommentReplyFlowDeps, actor: RequestActor, viewer: CommentReplyViewer, ids: string[]) {
  return tx(deps, actor.tenantId, async (scope) => {
    const { channelIds } = await reorderRules(scope, viewer, ids);
    await recordTenantAudit(scope, {
      actorId: actor.agentId,
      action: 'comment_reply.rule.reorder',
      targetType: 'comment_reply_rule',
      payload: { ids },
      ip: actor.ip,
    });
    bumpRulesVersion(scope, deps, channelIds);
    return { ok: true as const };
  });
}

export const testRulesFlow = (
  deps: CommentReplyFlowDeps,
  actor: RequestActor,
  viewer: CommentReplyViewer,
  input: { channelId: string; postId?: string; text: string },
) => tx(deps, actor.tenantId, (s) => testRules(s, viewer, input));

export const listMaterialOptionsFlow = (deps: CommentReplyFlowDeps, actor: RequestActor, viewer: CommentReplyViewer, channelId: string) =>
  tx(deps, actor.tenantId, (s) => listMaterialOptions(s, viewer, channelId));

// ─── 觸發紀錄 ────────────────────────────────────────────────────────────

export const listLogsFlow = (deps: CommentReplyFlowDeps, actor: RequestActor, viewer: CommentReplyViewer, q: LogsQuery) =>
  tx(deps, actor.tenantId, (s) => listLogs(s, viewer, q));

export const summarizeLogsFlow = (deps: CommentReplyFlowDeps, actor: RequestActor, viewer: CommentReplyViewer, q: LogsQuery) =>
  tx(deps, actor.tenantId, (s) => summarizeLogs(s, viewer, q));

export const getLogFlow = (deps: CommentReplyFlowDeps, actor: RequestActor, viewer: CommentReplyViewer, id: string) =>
  tx(deps, actor.tenantId, (s) => getLog(s, viewer, id));

/**
 * 把一筆（已是 PENDING 的）紀錄排入送出工作：寫 outbox，commit 後送進 comment-reply 佇列，job 名稱與收件相同。
 * job 資料只有識別欄位（spec「留言處理不把個資寫進工作與日誌」）；消費者以 status='PENDING' 條件認領，重複排入無害。
 */
export async function requeueCommentReplyLog(scope: TenantScope, deps: Pick<CommentReplyFlowDeps, 'prisma' | 'events'>, logId: string): Promise<void> {
  await enqueueJob(
    scope,
    deps.events ?? createOutboxPublisher(deps.prisma),
    COMMENT_REPLY_QUEUE,
    COMMENT_REPLY_JOB_DELIVER,
    { tenantId: scope.tenantId, logId },
    COMMENT_REPLY_JOB_OPTIONS,
  );
}

/** POST /logs/:id/retry：紀錄改回 PENDING、排入工作、寫稽核，同一交易 */
export function retryLogFlow(deps: CommentReplyFlowDeps, actor: RequestActor, viewer: CommentReplyViewer, id: string) {
  return tx(deps, actor.tenantId, async (scope) => {
    const log = await markLogForRetry(scope, viewer, id);
    await requeueCommentReplyLog(scope, deps, log.id);
    await recordTenantAudit(scope, {
      actorId: actor.agentId,
      action: 'comment_reply.log.retry',
      targetType: 'comment_reply_log',
      targetId: log.id,
      // 不含留言內容與留言者名稱
      payload: { channelId: log.channelId, previousStatus: log.previousStatus, previousReasonCode: log.previousReasonCode },
      ip: actor.ip,
    });
    return { status: 'PENDING' as const };
  });
}

// ─── 渠道 ────────────────────────────────────────────────────────────────

/** GET /readiness：資料庫部分在交易內，查 Meta 在交易外（快取 5 分鐘、每渠道 3 秒） */
export async function readinessFlow(deps: CommentReplyFlowDeps, actor: RequestActor, viewer: CommentReplyViewer) {
  const base = await tx(deps, actor.tenantId, async (scope) => {
    const settings = await readCommentReplyPlatformSettings(scope.tx);
    return loadReadinessBase(scope, viewer, settings);
  });
  return buildReadiness(base, deps.redis);
}

/** 開啟（receiving=true）或關閉留言接收：交易外呼叫 subscribeFields，成功後寫渠道設定與稽核 */
export async function setCommentReceivingFlow(
  deps: CommentReplyFlowDeps,
  actor: RequestActor,
  viewer: CommentReplyViewer,
  channelId: string,
  receiving: boolean,
) {
  const channel = await tx(deps, actor.tenantId, (s) => loadCommentChannel(s, viewer, channelId, { requireEdit: true }));
  const fields = commentSubscriptionFields(channel, receiving);
  await subscribeCommentFieldsMeta(channel, fields);
  await tx(deps, actor.tenantId, async (scope) => {
    await saveCommentSubscription(scope, channel, receiving, fields);
    await recordTenantAudit(scope, {
      actorId: actor.agentId,
      action: 'channel.comment_subscription.update',
      targetType: 'channel',
      targetId: channel.id,
      payload: { receiving, fields },
      ip: actor.ip,
    });
    const redis = deps.redis;
    if (redis) scope.afterCommit('comment-reply readiness cache', () => redis.del(readinessCacheKey(channel.id)));
  });
  return { receiving };
}

async function loadPickerChannel(deps: CommentReplyFlowDeps, actor: RequestActor, viewer: CommentReplyViewer, channelId: string) {
  return tx(deps, actor.tenantId, async (scope: TenantCtx) => {
    const settings = await readCommentReplyPlatformSettings(scope.tx);
    const channel = await loadCommentChannel(scope, viewer, channelId);
    assertPostPickerCapability(channel, settings);
    return channel;
  });
}

/** GET /channels/:id/posts */
export async function listPostsFlow(deps: CommentReplyFlowDeps, actor: RequestActor, viewer: CommentReplyViewer, channelId: string, cursor?: string) {
  const channel = await loadPickerChannel(deps, actor, viewer, channelId);
  return listRecentPostsMeta(channel, cursor, deps.redis);
}

/** POST /channels/:id/posts/resolve */
export async function resolvePostFlow(deps: CommentReplyFlowDeps, actor: RequestActor, viewer: CommentReplyViewer, channelId: string, url: string) {
  const channel = await loadPickerChannel(deps, actor, viewer, channelId);
  try {
    return await resolvePostUrlMeta(channel, url);
  } catch (err) {
    logger.info('[CommentReply] 貼文網址解析失敗', { channelId, code: (err as { code?: string }).code });
    throw err;
  }
}
