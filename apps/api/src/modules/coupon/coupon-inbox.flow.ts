/**
 * 對話發券的入口（design D16）：發送鍵、三個步驟的串接與預設送出方式。
 *
 * 1. 交易：鎖券、檢查、建立發送中的券（reserveIssue）
 * 2. 交易外：送出發券訊息（渠道 API，最多送一次，不重試）
 * 3. 交易：成功就確認並寫入對話訊息（confirmIssue），失敗就作廢這張券（voidPendingInstance）
 *
 * 交易由這裡以 inTenant() 開；service 只收 TenantCtx（AGENTS.md 結構規則 2）。
 */
import type { PrismaClient } from '@prisma/client';
import type { Server } from 'socket.io';
import { logger } from '@open333crm/core';
import { inTenant, type TenantCtx } from '../../lib/tenant-ctx.js';
import { tenantScopedClient } from '../../lib/tenant-db.js';
import { eventBus } from '../../events/event-bus.js';
import { deliverToChannel } from '../conversation/conversation.service.js';
import {
  IssueAbort,
  REQUEST_KEEP_MS,
  confirmIssue,
  readStored,
  requestKeyOf,
  reserveIssue,
  voidPendingInstance,
  type InboxIssueDeps,
  type InboxIssueInput,
  type InboxIssueResult,
  type Reserved,
} from './coupon-inbox.service.js';

export interface DeliverParams {
  tenantId: string;
  conversationId: string;
  text: string;
}

export interface InboxFlowDeps extends InboxIssueDeps {
  prisma: PrismaClient;
  /** commit 後推播對話新訊息與「已發優惠券」更新 */
  io: Server;
  /** 送出發券訊息；預設走 deliverToChannel（測試可替換） */
  deliver?: (params: DeliverParams) => Promise<{ sent: boolean; reason?: string }>;
}

function inTenantOf<T>(deps: InboxFlowDeps, tenantId: string, fn: (ctx: TenantCtx) => Promise<T>): Promise<T> {
  return inTenant({ prisma: deps.prisma, io: deps.io, events: eventBus }, tenantId, fn);
}

/** 預設送出：走既有 deliverToChannel；座席主動發券時 replyToken 多半已失效，固定 push（design D7） */
async function defaultDeliver(prisma: PrismaClient, params: DeliverParams): Promise<{ sent: boolean }> {
  const sent = await deliverToChannel(tenantScopedClient(prisma, params.tenantId), params.conversationId, {
    contentType: 'text',
    content: { text: params.text, strategy: 'push' },
  });
  return { sent };
}

/**
 * 對話發券。同一個發送鍵只發出一張：處理中重送回 ISSUE_IN_PROGRESS，完成後重送回同一個結果。
 */
export async function issueInConversation(deps: InboxFlowDeps, input: InboxIssueInput): Promise<InboxIssueResult> {
  const key = requestKeyOf(input.tenantId, input.requestKey);
  // 發送鍵綁定這次發券的內容：同一個鍵換成別的券或對話，不回傳上一次的結果
  const fingerprint = `${input.conversationId}:${input.couponId}`;
  const claimed = await deps.store.set(key, JSON.stringify({ state: 'pending', for: fingerprint }), 'PX', REQUEST_KEEP_MS, 'NX');
  if (claimed !== 'OK') {
    const existing = await readStored(deps.store, key);
    if (existing && existing.for !== fingerprint) return { ok: false, reason: 'KEY_REUSED' };
    return existing?.state === 'done' && existing.result ? existing.result : { ok: false, reason: 'ISSUE_IN_PROGRESS' };
  }

  let result: InboxIssueResult;
  try {
    result = await runIssue(deps, input);
  } catch (err) {
    // 非預期錯誤：交易已回滾、券未發出，清掉發送鍵讓座席可以重送
    await deps.store.getdel(key);
    throw err;
  }
  // 以 XX 直接把「處理中」換成結果：先刪再寫會留下空窗，重送的請求會趁空窗再發一次
  await deps.store.set(key, JSON.stringify({ state: 'done', for: fingerprint, result }), 'PX', REQUEST_KEEP_MS, 'XX');
  return result;
}

async function runIssue(deps: InboxFlowDeps, input: InboxIssueInput): Promise<InboxIssueResult> {
  const { tenantId } = input;
  const deliver = deps.deliver ?? ((params: DeliverParams) => defaultDeliver(deps.prisma, params));

  let reserved: Reserved;
  try {
    reserved = await inTenantOf(deps, tenantId, (ctx) => reserveIssue(ctx, deps, input));
  } catch (err) {
    if (err instanceof IssueAbort) return err.result;
    throw err;
  }

  let sent = false;
  try {
    sent = (await deliver({
      tenantId,
      conversationId: reserved.conversationId,
      text: reserved.text,
    })).sent;
  } catch (err) {
    logger.error('[CouponInbox] 發券訊息送出時發生錯誤，券作廢', { tenantId, instanceId: reserved.instanceId, error: (err as Error).message });
  }
  if (!sent) {
    await inTenantOf(deps, tenantId, (ctx) => voidPendingInstance(ctx, reserved.instanceId));
    return { ok: false, reason: 'COUPON_DELIVERY_FAILED' };
  }

  // 訊息已送到顧客：確認失敗不能丟出例外（會清掉發送鍵，座席重送就發第二張），重試兩次後回報
  let message: Awaited<ReturnType<typeof confirmIssue>> = null;
  let confirmError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      message = await inTenantOf(deps, tenantId, (ctx) => confirmIssue(ctx, deps, input, reserved));
      confirmError = null;
      break;
    } catch (err) {
      confirmError = err;
    }
  }
  if (confirmError) {
    logger.error('[CouponInbox] 發券訊息已送出，但確認失敗', {
      tenantId,
      instanceId: reserved.instanceId,
      error: (confirmError as Error).message,
    });
    return { ok: false, reason: 'DELIVERED_UNCONFIRMED' };
  }
  if (!message) {
    logger.error('[CouponInbox] 發券訊息已送出，但券在確認前已被作廢', { tenantId, instanceId: reserved.instanceId });
    return { ok: false, reason: 'ISSUE_FAILED' };
  }
  return {
    ok: true,
    instanceId: reserved.instanceId,
    code: reserved.code,
    couponId: reserved.coupon.id,
    couponName: reserved.coupon.name,
    messageId: message.id,
  };
}
