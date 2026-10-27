/**
 * 傳訊領券的入站流程（add-coupon-system A15 15.30；design D30、D16）。
 *
 * 顧客在領券頁點「傳送領券訊息」（LINE 預填含代碼的文字），或點 FB／IG 帶 ref 的連結開啟對話，
 * 入站管線辨認出領券代碼後呼叫這裡：
 *
 * 1. 交易：檢查連結與渠道、建立發送中的券（reserveClaim）
 * 2. 交易外：產生票券連結（Redis）、以回覆方式送出發券訊息（渠道 API；30 秒內用 replyToken，否則 push）
 * 3. 交易：送出成功就確認（confirmClaim），失敗就作廢這張券、再回覆一次失敗說明，並在對話留下紀錄
 *
 * 不能發時同樣以回覆方式告訴顧客原因（已領過、已領完、活動無法領取、請到其他渠道），並在對話留下紀錄。
 * 交易由這裡以 inTenant() 開；service 只收 TenantCtx，推播與事件由這裡登記。
 */
import type { PrismaClient } from '@prisma/client';
import type { Server } from 'socket.io';
import {
  buildCouponMessage,
  couponLiffConfig,
  couponLinkUrl,
  issueWalletToken,
  logger,
  voidPendingInstance,
  type WalletTokenStore,
} from '@open333crm/core';
import { inTenant, type TenantScope } from '../../lib/tenant-ctx.js';
import { createOutboxPublisher } from '../../events/outbox-publisher.js';
import { notifyCouponMessage, notifyInstanceUpdated, publishCouponTag } from './coupon-effects.js';
import { tenantScopedClient } from '../../lib/tenant-db.js';
import { deliverToChannel } from '../conversation/conversation.service.js';
import { getConfig } from '../../config/env.js';
import { CLAIM_REPLY_TEXT, type ClaimFailureReason } from './coupon-claim-code.js';
import {
  confirmClaim,
  recordClaimReply,
  reserveClaim,
  type ClaimActor,
  type InboundClaimLink,
  type ReserveClaimResult,
} from './coupon-claim-link.service.js';

export interface ClaimDeliverParams {
  tenantId: string;
  conversationId: string;
  text: string;
  /** LINE 的回覆權杖與收到時間：30 秒內走 reply（不計額度），逾時或失敗改 push */
  replyToken?: string;
  receivedAt?: string;
}

export interface ClaimFlowDeps {
  /** 入站管線的 client（webhook 為 BYPASSRLS 連線，查詢一律帶 tenantId） */
  prisma: PrismaClient;
  io: Server;
  /** 票券連結權杖的儲存（Redis） */
  store: WalletTokenStore;
  webBaseUrl?: string;
  now?: () => number;
  /** 送出訊息；預設走 deliverToChannel（測試可替換） */
  deliver?: (params: ClaimDeliverParams) => Promise<boolean>;
}

export interface InboundClaimInput extends ClaimActor {
  tenantId: string;
  /** 收到訊息的渠道身分（票券連結用它產生 One ID 登記連結） */
  channelIdentityId: string;
  replyToken?: string;
  receivedAt?: string;
}

export type InboundClaimStatus = 'issued' | ClaimFailureReason;

function inTenantOf<T>(deps: ClaimFlowDeps, tenantId: string, fn: (scope: TenantScope) => Promise<T>): Promise<T> {
  return inTenant(deps.prisma, tenantId, fn);
}

async function defaultDeliver(prisma: PrismaClient, params: ClaimDeliverParams): Promise<boolean> {
  return deliverToChannel(tenantScopedClient(prisma, params.tenantId), params.conversationId, {
    contentType: 'text',
    content: { text: params.text },
    delivery: { replyToken: params.replyToken, receivedAt: params.receivedAt },
  });
}

/** 送出；丟錯視為送不出（不能讓例外中斷後面的作廢與紀錄） */
async function send(deps: ClaimFlowDeps, input: InboundClaimInput, text: string): Promise<boolean> {
  const deliver = deps.deliver ?? ((p: ClaimDeliverParams) => defaultDeliver(deps.prisma, p));
  try {
    return await deliver({
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      text,
      replyToken: input.replyToken,
      receivedAt: input.receivedAt,
    });
  } catch (err) {
    logger.error('[CouponClaim] 訊息送出時發生錯誤', { tenantId: input.tenantId, conversationId: input.conversationId, error: (err as Error).message });
    return false;
  }
}

/** 沒有發出券：回覆顧客原因，並在對話留下紀錄（紀錄失敗只寫 log，不能讓入站處理失敗） */
async function replyFailure(
  deps: ClaimFlowDeps,
  link: InboundClaimLink,
  input: InboundClaimInput,
  reason: ClaimFailureReason,
  text: string,
): Promise<InboundClaimStatus> {
  const delivered = await send(deps, input, text);
  try {
    await inTenantOf(deps, input.tenantId, async (scope) => {
      const message = await recordClaimReply(scope, link, input.conversationId, { text, reason, delivered }, new Date((deps.now ?? Date.now)()));
      notifyCouponMessage(scope, deps.io, message);
    });
  } catch (err) {
    logger.error('[CouponClaim] 無法在對話留下領券紀錄', { tenantId: input.tenantId, conversationId: input.conversationId, reason, error: (err as Error).message });
  }
  return reason;
}

/**
 * 處理一則含領券代碼的入站訊息。回傳結果（'issued' 或沒發出的原因）。
 * 呼叫端已確認代碼屬於本租戶（findInboundClaimLink）。
 */
export async function claimFromInbound(
  deps: ClaimFlowDeps,
  link: InboundClaimLink,
  input: InboundClaimInput,
): Promise<InboundClaimStatus> {
  const { tenantId } = input;
  const now = () => new Date((deps.now ?? Date.now)());

  let reserved: ReserveClaimResult;
  try {
    reserved = await inTenantOf(deps, tenantId, (scope) => reserveClaim(scope, link, input, now()));
  } catch (err) {
    logger.error('[CouponClaim] 保留券時發生錯誤', { tenantId, linkId: link.id, error: (err as Error).message });
    return replyFailure(deps, link, input, 'ISSUE_FAILED', CLAIM_REPLY_TEXT.failed);
  }
  if (!reserved.ok) return replyFailure(deps, link, input, reserved.reason, reserved.replyText);

  const { instanceId } = reserved.reserved;
  const voidIt = () => inTenantOf(deps, tenantId, (scope) => voidPendingInstance(scope.tx, tenantId, instanceId));

  // 票券連結（Redis）在交易外產生；失敗就作廢券並告訴顧客
  let text: string;
  try {
    const token = await issueWalletToken(deps.store, {
      tenantId,
      contactId: input.contactId,
      channelIdentityId: input.channelIdentityId,
      channelId: input.channelId,
      conversationId: input.conversationId,
      instanceId,
    }, deps.now);
    const channel = await deps.prisma.channel.findFirst({ where: { id: input.channelId, tenantId }, select: { settings: true } });
    text = buildCouponMessage({
      couponName: link.coupon.name,
      url: couponLinkUrl(deps.webBaseUrl ?? getConfig().WEB_BASE_URL, token, couponLiffConfig(channel?.settings)),
    });
  } catch (err) {
    logger.error('[CouponClaim] 票券連結產生失敗，券作廢', { tenantId, instanceId, error: (err as Error).message });
    await voidIt().catch((voidErr) => logger.error('[CouponClaim] 作廢失敗，交給排程', { instanceId, error: (voidErr as Error).message }));
    return replyFailure(deps, link, input, 'ISSUE_FAILED', CLAIM_REPLY_TEXT.failed);
  }

  if (!(await send(deps, input, text))) {
    try {
      await voidIt();
    } catch (err) {
      // 作廢失敗時券仍在發送中，排程會在 5 分鐘後作廢（design D16 第 5 步）
      logger.error('[CouponClaim] 作廢失敗，交給排程', { tenantId, instanceId, error: (err as Error).message });
    }
    // 顧客傳了領券訊息卻什麼都沒收到會以為沒反應：再回覆一次失敗說明（只試一次，不重試；
    // 券已作廢，說明與實際結果一致）。對話留下顧客實際收到的說明，客服從原因看得出發券訊息送不出
    const failureText = CLAIM_REPLY_TEXT.failed;
    const replied = await send(deps, input, failureText);
    try {
      await inTenantOf(deps, tenantId, async (scope) => {
        const message = await recordClaimReply(scope, link, input.conversationId, { text: failureText, reason: 'DELIVERY_FAILED', delivered: replied }, now());
        notifyCouponMessage(scope, deps.io, message);
      });
    } catch (err) {
      logger.error('[CouponClaim] 無法在對話留下領券紀錄', { tenantId, error: (err as Error).message });
    }
    return 'DELIVERY_FAILED';
  }

  // 訊息已送到顧客：確認失敗重試兩次；仍失敗時券留在發送中，排程會作廢
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const message = await inTenantOf(deps, tenantId, async (scope) => {
        const confirmed = await confirmClaim(scope, link, input, reserved.reserved, text, now());
        if (!confirmed) return null;
        if (confirmed.tag) await publishCouponTag(scope, createOutboxPublisher(deps.prisma), input.contactId, confirmed.tag);
        notifyCouponMessage(scope, deps.io, confirmed.message);
        notifyInstanceUpdated(scope, deps.io, { instanceId, contactId: input.contactId, change: 'issued' });
        return confirmed.message;
      });
      if (!message) {
        logger.error('[CouponClaim] 發券訊息已送出，但券在確認前已被作廢', { tenantId, instanceId });
        return 'ISSUE_FAILED';
      }
      return 'issued';
    } catch (err) {
      if (attempt === 2) {
        logger.error('[CouponClaim] 發券訊息已送出，但確認失敗', { tenantId, instanceId, error: (err as Error).message });
      }
    }
  }
  return 'ISSUE_FAILED';
}
