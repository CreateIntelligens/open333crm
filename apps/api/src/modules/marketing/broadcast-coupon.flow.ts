/**
 * 附券廣播的發送（add-coupon-system design D29、D31）：由排程在背景執行，不在 HTTP 請求內。
 *
 * 交易由這裡以 inTenant() 開，每一步一個短交易；渠道 API 與 Redis（票券連結）都在交易外
 * （AGENTS.md 結構規則 2）。各步驟失敗時資料的去向見 broadcast-coupon.service.ts 開頭的表。
 */
import type { PrismaClient } from '@prisma/client';
import type { Server } from 'socket.io';
import { getChannelPlugin, type ChannelPlugin } from '@open333crm/channel-plugins';
import {
  buildCouponMessage,
  couponLiffConfig,
  couponLinkUrl,
  issueWalletToken,
  logger,
  type WalletTokenStore,
} from '@open333crm/core';
import { flowOf, inTenant, type TenantScope } from '../../lib/tenant-ctx.js';
import { createOutboxPublisher, enqueueJob, type EventPublisher } from '../../events/outbox-publisher.js';
import { publishCouponTag } from '../coupon/coupon-effects.js';
import { snapshotOgInBackground, writeOgInTenant } from '../shortlink/og-snapshot.js';
import { getConfig } from '../../config/env.js';
import { AppError } from '../../shared/utils/response.js';
import { decryptCredentials } from '../channel/channel.service.js';
import { UNEXPECTED_FAILURE_REASON, convertBodyUrlsToShortLinks } from './marketing.service.js';
import { buildVariableMap, renderTemplateBody } from './template-renderer.js';
import {
  COUPON_BROADCAST_JOB_OPTIONS,
  COUPON_BROADCAST_QUEUE,
  COUPON_URL_VARIABLE,
  PROGRESS_EVERY,
  claimCouponBroadcast,
  createBatchIssue,
  queueCouponBroadcast,
  confirmRecipient,
  failCouponBroadcast,
  finalizeCouponBroadcast,
  getCouponBroadcastSummary,
  listBroadcastRecipients,
  markRecipient,
  prepareRecipients,
  recordProgress,
  reserveRecipient,
  voidRecipient,
  type BatchIssueInput,
  type CouponBroadcastJobData,
  type CouponBroadcastPlan,
  type CouponBroadcastSummary,
  type PendingRecipient,
  type RecipientFailReason,
} from './broadcast-coupon.service.js';

/** 附券廣播的結果：發券張數、依原因分列的跳過與失敗人數（design D29） */
export const getCouponBroadcastSummaryFlow = flowOf(getCouponBroadcastSummary);

/** 結果頁的收件人與跳過、失敗的原因 */
export const listBroadcastRecipientsFlow = flowOf(listBroadcastRecipients);

/** 排入發送的入口：events 預設寫 outbox（測試可替換） */
export interface QueueBroadcastDeps {
  prisma: PrismaClient;
  events?: EventPublisher;
}

/** 立即執行的 job 與排入發送在同一個交易寫進 outbox，commit 後送進 coupon-broadcast 佇列 */
function enqueueBroadcastRun(scope: TenantScope, deps: QueueBroadcastDeps, job: CouponBroadcastJobData) {
  return enqueueJob(scope, deps.events ?? createOutboxPublisher(deps.prisma), COUPON_BROADCAST_QUEUE, 'run', job, COUPON_BROADCAST_JOB_OPTIONS);
}

/** 附券廣播「立即發送」：排入發送並馬上排一個執行的 job（change fix-coupon-broadcast-immediate-run） */
/** 發送途中券不能再發時的停止原因：暫停可以恢復後重新發送，到期要改附其他券（PR #385 審查） */
export function couponUnavailableStop(cause: 'inactive' | 'expired', left: number): { code: string; reason: string } {
  return cause === 'expired'
    ? {
      code: 'COUPON_EXPIRED',
      reason: `優惠券在發送途中過了到期日，已停止發送；其餘 ${left} 位沒有發送。請改附其他券建立新的廣播，已處理的人不會重複收到`,
    }
    : {
      code: 'COUPON_NOT_ACTIVE',
      reason: `優惠券在發送途中被暫停或結束，已停止發送；其餘 ${left} 位沒有發送。恢復發放後可以重新發送，已處理的人不會重複收到`,
    };
}

export function queueCouponBroadcastFlow(deps: QueueBroadcastDeps, tenantId: string, broadcastId: string, now?: number) {
  return inTenant(deps.prisma, tenantId, async (scope) => {
    const { job, ...queued } = await queueCouponBroadcast(scope, broadcastId, now);
    await enqueueBroadcastRun(scope, deps, job);
    return queued;
  });
}

/** 券詳情頁的批次發券：建立廣播、排入發送並馬上排一個執行的 job */
export function createBatchIssueFlow(
  deps: QueueBroadcastDeps,
  tenantId: string,
  agentId: string,
  couponId: string,
  input: BatchIssueInput,
) {
  return inTenant(deps.prisma, tenantId, async (scope) => {
    const { job, ...created } = await createBatchIssue(scope, agentId, couponId, input);
    await enqueueBroadcastRun(scope, deps, job);
    return created;
  });
}

export interface CouponBroadcastDeps {
  /** app_tenant 的基底連線（inTenant 用） */
  prisma: PrismaClient;
  io?: Server;
  /** 票券連結的儲存（Redis） */
  store: WalletTokenStore;
  /** 票券連結的網址前綴；預設為 WEB_BASE_URL */
  webBaseUrl?: string;
  now?: () => number;
}

export type CouponBroadcastRunResult =
  | { status: 'not_claimed' }
  | { status: 'failed'; failureCode: string; summary?: CouponBroadcastSummary }
  | { status: 'completed' | 'failed'; summary: CouponBroadcastSummary }
  /** 這次執行已被重新排入的新執行取代：停止，進度與結果由新的執行寫入 */
  | { status: 'superseded'; summary?: CouponBroadcastSummary };

interface OutboundMessage {
  contentType: string;
  content: Record<string, unknown>;
}

function step<T>(deps: CouponBroadcastDeps, tenantId: string, fn: (scope: TenantScope) => Promise<T>): Promise<T> {
  return inTenant(deps.prisma, tenantId, fn);
}

/** 名單為空時依對象類型說明原因（與一般廣播相同的文字） */
function noRecipientReason(targetType: string): string {
  if (targetType === 'contacts') return '未選擇任何發送對象，或所選對象在此渠道沒有可發送的身分。請先挑選有加入此渠道的對象。';
  if (targetType === 'tags') return '所選標籤下沒有可在此渠道發送的對象。';
  if (targetType === 'segment') return '所選分群目前沒有可在此渠道發送的對象。';
  return '此渠道目前沒有可發送的對象。';
}

/**
 * 每位收件人的訊息：素材有 {{coupon.url}} 只送素材；沒有就先送素材、再送發券文字；沒選素材只送發券文字。
 * 帶連結的那則一定是最後一則。
 */
export function buildRecipientMessages(
  plan: Pick<CouponBroadcastPlan, 'material' | 'materialHasCouponUrl' | 'coupon'> & {
    broadcast: Pick<CouponBroadcastPlan['broadcast'], 'couponMessage'>;
  },
  body: Record<string, unknown> | null,
  vars: Record<string, string>,
  url: string,
): OutboundMessage[] {
  const custom = plan.broadcast.couponMessage?.trim();
  const couponText = custom ? `${custom}\n\n${url}` : buildCouponMessage({ couponName: plan.coupon.name, url });
  const couponMessage: OutboundMessage = { contentType: 'text', content: { text: couponText } };
  if (!plan.material || !body) return [couponMessage];
  const rendered = renderTemplateBody(body, {
    ...buildVariableMap(plan.material.variables, vars),
    [COUPON_URL_VARIABLE]: url,
  });
  const material: OutboundMessage = { contentType: plan.material.contentType, content: rendered };
  return plan.materialHasCouponUrl ? [material] : [material, couponMessage];
}

type SendOutcome = { ok: true } | { ok: false; reason: RecipientFailReason; error: string | null };

/**
 * 送出一位收件人的訊息（主動推送，每則最多送一次、不重試）。渠道一次能送多則時同一次請求送出
 * （LINE：兩則同時成功或失敗）；否則依序呼叫，前一則送不出就不送下一則。
 */
async function sendToRecipient(
  plugin: ChannelPlugin,
  credentials: Record<string, unknown>,
  uid: string,
  messages: OutboundMessage[],
): Promise<SendOutcome> {
  const push = (m: OutboundMessage) => ({ contentType: m.contentType, content: { ...m.content, strategy: 'push' } });
  const call = async (payload: Parameters<ChannelPlugin['sendMessage']>[1]) => {
    try {
      const r = await plugin.sendMessage(uid, payload, credentials);
      return r.success ? null : r.error ?? '渠道沒有回傳原因';
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  };
  if (messages.length <= (plugin.maxMessagesPerSend ?? 1)) {
    const [first, ...rest] = messages;
    const error = await call({ ...push(first), ...(rest.length ? { extraMessages: rest.map(push) } : {}) });
    return error === null ? { ok: true } : { ok: false, reason: 'DELIVERY_FAILED', error };
  }
  for (let i = 0; i < messages.length; i++) {
    const error = await call(push(messages[i]));
    if (error !== null) return { ok: false, reason: i === 0 ? 'DELIVERY_FAILED' : 'COUPON_MESSAGE_FAILED', error };
  }
  return { ok: true };
}

/**
 * 發送一則已排程的附券廣播。搶不到（已在發送或不是附券廣播）回 not_claimed。
 * 預期內的失敗（額度不足、券已暫停等）寫進廣播的 failureCode／failureReason；非預期的錯誤也先標失敗再往上拋。
 */
export async function runCouponBroadcast(
  deps: CouponBroadcastDeps,
  tenantId: string,
  broadcastId: string,
): Promise<CouponBroadcastRunResult> {
  const now = () => (deps.now ?? Date.now)();
  // 搶占時間也是這次執行的代次（broadcasts.sentAt）：之後的寫入都以它比對
  const startedAt = now();
  const runStartedAt = new Date(startedAt);
  const claimed = await step(deps, tenantId, (ctx) => claimCouponBroadcast(ctx, broadcastId, startedAt));
  if (!claimed.ok && claimed.reason === 'NOT_CLAIMED') return { status: 'not_claimed' };

  const fail = async (code: string, reason: string): Promise<CouponBroadcastRunResult> => {
    await step(deps, tenantId, (ctx) => failCouponBroadcast(ctx, broadcastId, code, reason, runStartedAt));
    logger.warn('[CouponBroadcast] 附券廣播沒有發送', { tenantId, broadcastId, code });
    return { status: 'failed', failureCode: code };
  };
  if (!claimed.ok) return fail(claimed.code, claimed.message);
  const { plan } = claimed;

  try {
    const plugin = getChannelPlugin(plan.channel.channelType);
    if (!plugin) return fail('UNSUPPORTED_CHANNEL', `此渠道類型（${plan.channel.channelType}）不支援發送廣播`);
    let credentials: Record<string, unknown>;
    try {
      credentials = decryptCredentials(plan.channel.credentialsEncrypted);
    } catch {
      return fail(
        'CHANNEL_CREDENTIAL_DECRYPT_FAILED',
        '此渠道的憑證無法解密（金鑰不符，常見於從其他環境同步過來的資料）。請到渠道設定重新填入 Access Token 後再發送。',
      );
    }

    // 素材級點擊歸因：外部連結換成短連結（含變數的連結每人不同，不換）。失敗不阻斷發送，退回原素材
    let body = plan.material?.body ?? null;
    if (plan.material && body) {
      const original = body;
      const created: Array<{ id: string; targetUrl: string }> = [];
      try {
        body = await step(deps, tenantId, (ctx) =>
          convertBodyUrlsToShortLinks(ctx.tx as unknown as PrismaClient, tenantId, plan.broadcast.createdById, plan.material!.id, null, original, created));
        // 交易已經 commit：在背景為新建的短連結抓 OG 快照，另開交易寫回（最多一次）
        for (const link of created) snapshotOgInBackground(link, writeOgInTenant(deps.prisma, tenantId, link));
      } catch (err) {
        logger.error('[CouponBroadcast] 素材連結換短連結失敗，改送原素材', { tenantId, broadcastId, error: (err as Error).message });
        body = original;
      }
    }

    const prepared = await step(deps, tenantId, (ctx) => prepareRecipients(ctx, plan, plugin.messagingWindowHours));
    if (prepared.total === 0) return fail('BROADCAST_NO_RECIPIENTS', noRecipientReason(plan.broadcast.targetType));

    // 訊息額度：剩餘額度小於這次要送的人數就整則不送、不建任何券（同一次推送多則只算一次）
    const quotaOf = plugin.extensions?.analytics?.getMessageQuota;
    if (prepared.pending.length > 0 && quotaOf) {
      let quota: { totalUsage: number; maxMessages?: number };
      try {
        quota = await quotaOf(credentials);
      } catch (err) {
        logger.error('[CouponBroadcast] 查詢訊息額度失敗', { tenantId, broadcastId, error: (err as Error).message });
        return fail('LINE_QUOTA_CHECK_FAILED', '無法查詢官方帳號本月的訊息額度，沒有發送。請稍後重新發送');
      }
      if (quota.maxMessages !== undefined && quota.maxMessages - quota.totalUsage < prepared.pending.length) {
        const left = Math.max(0, quota.maxMessages - quota.totalUsage);
        return fail(
          'LINE_QUOTA_INSUFFICIENT',
          `官方帳號本月剩餘訊息額度 ${left} 則，少於這次要發送的 ${prepared.pending.length} 人，沒有發送也沒有發出任何券。請提高額度或縮小對象後重新發送`,
        );
      }
    }

    let firstError: string | null = null;
    let stopped: { code: string; reason: string } | undefined;
    for (let i = 0; i < prepared.pending.length; i++) {
      const outcome = await processRecipient(deps, tenantId, plan, plugin, credentials, body, prepared.pending[i]);
      if (outcome.superseded) {
        logger.warn('[CouponBroadcast] 這次執行已被重新排入的新執行取代，停止', { tenantId, broadcastId });
        return { status: 'superseded' };
      }
      if (outcome.error && !firstError) firstError = outcome.error;
      if (outcome.couponUnavailable) {
        const left = prepared.pending.length - i;
        stopped = couponUnavailableStop(outcome.couponUnavailable, left);
        break;
      }
      if ((i + 1) % PROGRESS_EVERY === 0) await step(deps, tenantId, (ctx) => recordProgress(ctx, broadcastId, runStartedAt));
    }

    const result = await step(deps, tenantId, (ctx) => finalizeCouponBroadcast(ctx, plan, { stopped, firstError, now: now() }));
    return result.status === 'superseded' ? { status: 'superseded', summary: result.summary } : { status: result.status, summary: result.summary };
  } catch (err) {
    // 非預期錯誤：原因寫進資料庫，後台才看得到（issue #287）；已處理的人有收件紀錄，重新發送不會重複
    const reason = err instanceof AppError ? err.message : UNEXPECTED_FAILURE_REASON;
    const code = err instanceof AppError ? err.code : 'UNEXPECTED_ERROR';
    await step(deps, tenantId, (ctx) => failCouponBroadcast(ctx, broadcastId, code, reason, runStartedAt)).catch((markErr: unknown) => {
      logger.error('[CouponBroadcast] 標記失敗時又發生錯誤', { tenantId, broadcastId, error: (markErr as Error).message });
    });
    throw err;
  }
}

/** 一位收件人：保留 → 產生連結 → 送出 → 確認或作廢 */
async function processRecipient(
  deps: CouponBroadcastDeps,
  tenantId: string,
  plan: CouponBroadcastPlan,
  plugin: ChannelPlugin,
  credentials: Record<string, unknown>,
  body: Record<string, unknown> | null,
  recipient: PendingRecipient,
): Promise<{ error?: string | null; couponUnavailable?: 'inactive' | 'expired'; superseded?: boolean }> {
  const now = () => (deps.now ?? Date.now)();
  const broadcastId = plan.broadcast.id;
  const reservation = await step(deps, tenantId, (ctx) => reserveRecipient(ctx, plan, recipient, now()));
  if (reservation.kind === 'coupon_unavailable') return { couponUnavailable: reservation.expired ? 'expired' : 'inactive' };
  if (reservation.kind === 'superseded') return { superseded: true };
  if (reservation.kind !== 'reserved') return {};
  const { instanceId } = reservation;
  const voidWith = (reason: RecipientFailReason) =>
    step(deps, tenantId, (ctx) => voidRecipient(ctx, broadcastId, recipient.contactId, instanceId, reason));

  let url: string;
  try {
    const token = await issueWalletToken(deps.store, {
      tenantId,
      contactId: recipient.contactId,
      channelIdentityId: recipient.channelIdentityId,
      channelId: plan.channel.id,
      // 不帶對話：收件人可能沒有對話（design D29）
      instanceId,
    }, deps.now);
    url = couponLinkUrl(deps.webBaseUrl ?? getConfig().WEB_BASE_URL, token, couponLiffConfig(plan.channel.settings));
  } catch (err) {
    logger.error('[CouponBroadcast] 票券連結產生失敗，券作廢', { tenantId, broadcastId, instanceId, error: (err as Error).message });
    await voidWith('LINK_FAILED');
    return { error: '票券連結產生失敗' };
  }

  const messages = buildRecipientMessages(plan, body, reservation.vars, url);
  const sent = await sendToRecipient(plugin, credentials, recipient.uid, messages);
  if (!sent.ok) {
    await voidWith(sent.reason);
    return { error: sent.error };
  }

  // 訊息已送到顧客：確認失敗不能當成沒送（不重送），重試兩次後標記並由券的排程作廢
  let confirmError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await step(deps, tenantId, async (scope) => {
        const confirmed = await confirmRecipient(scope, plan, recipient, instanceId, now());
        if (confirmed.tag) await publishCouponTag(scope, createOutboxPublisher(deps.prisma), recipient.contactId, confirmed.tag);
      });
      confirmError = null;
      break;
    } catch (err) {
      confirmError = err;
    }
  }
  if (confirmError) {
    logger.error('[CouponBroadcast] 發券訊息已送出，但確認失敗', {
      tenantId, broadcastId, instanceId, error: (confirmError as Error).message,
    });
    await step(deps, tenantId, (ctx) => markRecipient(ctx, broadcastId, recipient.contactId, 'failed', 'DELIVERED_UNCONFIRMED'))
      .catch(() => undefined);
  }
  return {};
}
