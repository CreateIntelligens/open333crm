/**
 * 入站管線的傳訊領券攔截（add-coupon-system A15 15.30；design D30）。
 *
 * 位置比照跨渠道綁定代碼（inbound-identity-binding.ts）：在 postback 攔截與 message.received
 * （AI／關鍵字／自動化）之前執行。訊息含本租戶的領券代碼時發券並回覆，這則訊息不再觸發 AI 與關鍵字規則；
 * 其他租戶的代碼查不到，照一般訊息處理。命中時仍推送 socket 事件，客服在收件匣看得到顧客送出的訊息。
 */
import { logger } from '@open333crm/core';
import type { InboundMessageContext } from './inbound-message.types.js';
import { emitInboundSocketEvents, sendFirstContactGreeting } from './inbound-side-effects.js';
import { getBindingStore, type BindingStore } from '../identity-binding/binding-code.js';
import { claimCodeFromRef, extractClaimCodeCandidates } from '../coupon/coupon-claim-code.js';
import { findInboundClaimLink } from '../coupon/coupon-claim-link.service.js';
import { claimFromInbound, type ClaimFlowDeps, type InboundClaimStatus } from '../coupon/coupon-claim.flow.js';

const REFERRAL_DEDUP_MS = 10 * 60 * 1000;

/** 測試可注入記憶體儲存、送出替身與時間 */
let overrides: Partial<Pick<ClaimFlowDeps, 'deliver' | 'now' | 'webBaseUrl'>> & { store?: BindingStore } = {};
export function setCouponClaimDepsForTest(next: typeof overrides | null): void {
  overrides = next ?? {};
}

const storeOf = (): BindingStore => overrides.store ?? getBindingStore();

function depsOf(ctx: InboundMessageContext): ClaimFlowDeps {
  return {
    prisma: ctx.prisma,
    io: ctx.io,
    store: storeOf(),
    deliver: overrides.deliver,
    now: overrides.now,
    webBaseUrl: overrides.webBaseUrl,
  };
}

/** 訊息的領券代碼候選：FB／IG 導流的 ref 優先，其次是訊息文字 */
function candidatesOf(ctx: InboundMessageContext): string[] {
  const fromRef = claimCodeFromRef(ctx.parsed.referralRef);
  if (fromRef) return [fromRef];
  if (ctx.contentType !== 'text') return [];
  return extractClaimCodeCandidates(ctx.textContent);
}

async function channelIdentityIdOf(ctx: InboundMessageContext): Promise<string | null> {
  const known = (ctx.channelIdentity as { id?: string } | null | undefined)?.id;
  if (known) return known;
  const identity = await ctx.prisma.channelIdentity.findUnique({
    where: { channelId_uid: { channelId: ctx.channel.id, uid: ctx.contactUid } },
    select: { id: true },
  });
  return identity?.id ?? null;
}

function replyTokenOf(ctx: InboundMessageContext): string | undefined {
  const raw = (ctx.parsed as { rawPayload?: { replyToken?: unknown } }).rawPayload;
  return typeof raw?.replyToken === 'string' ? raw.replyToken : undefined;
}

async function runClaim(
  ctx: InboundMessageContext,
  link: NonNullable<Awaited<ReturnType<typeof findInboundClaimLink>>>,
): Promise<InboundClaimStatus | 'error'> {
  const identityId = await channelIdentityIdOf(ctx);
  if (!identityId || !ctx.contactId || !ctx.conversation) {
    logger.error('[Webhook] 領券代碼命中，但找不到顧客的渠道身分或對話', { channelId: ctx.channel.id, linkId: link.id });
    return 'error';
  }
  return claimFromInbound(depsOf(ctx), link, {
    tenantId: ctx.tenantId,
    channelId: ctx.channel.id,
    channelIdentityId: identityId,
    contactId: ctx.contactId,
    conversationId: ctx.conversation.id,
    replyToken: replyTokenOf(ctx),
    receivedAt: ctx.now.toISOString(),
  });
}

/**
 * 一般訊息的領券攔截。回傳 true 時呼叫端應結束後續流程（不跑 AI／關鍵字／自動化）。
 */
export async function interceptCouponClaim(ctx: InboundMessageContext): Promise<boolean> {
  if (!ctx.contactId || !ctx.conversation) return false;
  const candidates = candidatesOf(ctx);
  if (candidates.length === 0) return false;
  const link = await findInboundClaimLink(ctx.prisma, ctx.tenantId, candidates);
  if (!link) return false;

  if (ctx.message) await emitInboundSocketEvents(ctx);
  // 新好友的招呼語先送，發券回覆在後（招呼語不用 replyToken，回覆權杖留給發券訊息）
  await sendFirstContactGreeting(ctx);
  const status = await runClaim(ctx, link);
  logger.info('[Webhook] 傳訊領券', { channelId: ctx.channel.id, linkId: link.id, status });
  return true;
}

/**
 * contentType 為 'referral' 的事件（FB／IG 既有對話點 m.me／ig.me 連結，只帶 ref）。
 * ref 不是領券格式（coupon_XXXXXXXX）時回 false，由綁定代碼的處理接手。是領券格式就回 true：
 * 本租戶查無這個代碼時只記錄、不建立聯絡人或對話——綁定代碼的格式是 BIND-…，領券格式的 ref
 * 交給它也只會記錄「不是綁定代碼」，行為相同。
 *
 * @param resolve 解析聯絡人與對話（由 webhook.service 傳入，避免循環相依）
 */
export async function handleCouponClaimReferral(
  ctx: InboundMessageContext,
  resolve: (ctx: InboundMessageContext) => Promise<void>,
): Promise<boolean> {
  const code = claimCodeFromRef(ctx.parsed.referralRef);
  if (!code) return false;
  const link = await findInboundClaimLink(ctx.prisma, ctx.tenantId, [code]);
  if (!link) {
    logger.info('[Webhook] Referral event ignored', { channelId: ctx.channel.id, reason: 'claim_code_not_found' });
    return true;
  }

  // 先解析聯絡人再寫去重 key：解析失敗會往外拋讓平台重送，重送時不會被去重擋掉
  await resolve(ctx);
  if (!ctx.contactId || !ctx.conversation) return true;
  // 獨立 referral 事件沒有平台訊息 id，平台重送同一事件時以渠道＋顧客＋代碼去重 10 分鐘
  const first = await storeOf().set(`couponclaim:referral-seen:${ctx.channel.id}:${ctx.contactUid}:${code}`, '1', 'PX', REFERRAL_DEDUP_MS, 'NX');
  if (first !== 'OK') {
    logger.info('[Webhook] Duplicate coupon claim referral ignored', { channelId: ctx.channel.id, code });
    return true;
  }
  await sendFirstContactGreeting(ctx);
  const status = await runClaim(ctx, link);
  logger.info('[Webhook] 傳訊領券（導流）', { channelId: ctx.channel.id, linkId: link.id, status });
  return true;
}
