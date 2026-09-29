/**
 * 入站管線的跨渠道綁定攔截（change add-cross-channel-one-id，design D3 / D4）。
 *
 * 在首次打招呼訊息、其他 postback 攔截與 message.received（AI／關鍵字／自動化）之前執行；
 * 命中時仍推送 socket 事件，讓客服在收件匣看得到顧客送出的綁定訊息。
 */
import { logger } from '@open333crm/core';
import type { InboundMessageContext } from './inbound-message.types.js';
import { emitInboundSocketEvents, sendFirstContactGreeting } from './inbound-side-effects.js';
import { buildMessageNewPayload, emitToConversationAndTenant } from './inbound-socket-presenter.js';
import { extractBindingCode, getBindingStore, type BindingStore } from '../identity-binding/binding-code.js';
import {
  detectBindingIntent,
  executeBindingIntent,
  getIdentityBindingSettingsCached,
} from '../identity-binding/identity-binding.service.js';

const REFERRAL_DEDUP_MS = 10 * 60 * 1000;

/** 測試可注入記憶體版儲存 */
let storeOverride: BindingStore | null = null;
export function setBindingStoreForTest(store: BindingStore | null): void {
  storeOverride = store;
}

/** 訊息文字或 FB／IG referral ref 中的綁定代碼 */
function codeFrom(ctx: InboundMessageContext): string | null {
  return extractBindingCode(ctx.parsed.referralRef) ?? extractBindingCode(ctx.textContent);
}

export interface BindingInterceptResult {
  handled: boolean;
  /** 處理結果；'bound' 表示本則訊息的聯絡人已併入既有聯絡人 */
  status?: string;
}

/**
 * 一般訊息（文字、postback）的綁定攔截。handled=true 時呼叫端應結束後續流程（不跑 AI／自動化）。
 */
export async function interceptIdentityBinding(ctx: InboundMessageContext): Promise<BindingInterceptResult> {
  if (!ctx.contactId || !ctx.conversation) return { handled: false };

  const intent = await detectBindingIntent(ctx.prisma, {
    tenantId: ctx.tenantId,
    contactId: ctx.contactId,
    text: ctx.textContent,
    code: codeFrom(ctx),
    getChannelIdentityId: () => findChannelIdentityId(ctx),
  });
  if (!intent) return { handled: false };

  if (ctx.message) await emitInboundSocketEvents(ctx);
  // 一般訊息與 postback 都有平台訊息 id（FB postback.mid、IG message.mid），重送已由
  // channelMsgId 去重擋下，這裡不需另外去重；只有獨立 referral 事件沒有 id（見 handleReferralEvent）
  const status = await runBindingIntent(ctx, intent);
  return { handled: true, status };
}

/**
 * 獨立 referral 事件的去重：這類事件沒有平台訊息 id，無法走一般訊息的去重，平台重送同一事件時
 * 會變成「剛綁定成功又收到代碼無效」。以渠道＋顧客＋代碼做 10 分鐘的去重，第一次回 true。
 */
async function firstSeenReferral(ctx: InboundMessageContext, code: string): Promise<boolean> {
  const store = storeOverride ?? getBindingStore();
  const first = await store.set(
    `bindcode:referral-seen:${ctx.channel.id}:${ctx.contactUid}:${code}`,
    '1',
    'PX',
    REFERRAL_DEDUP_MS,
    'NX',
  );
  if (first !== 'OK') {
    logger.info('[Webhook] Duplicate referral ignored', { channelId: ctx.channel.id, code });
    return false;
  }
  return true;
}

/**
 * contentType 為 'referral' 的事件（FB／IG 既有對話點 m.me／ig.me 連結，只帶 ref、沒有訊息內容）。
 * 不是綁定代碼、或租戶未啟用綁定時只記錄，不建立聯絡人、對話或訊息。
 *
 * @param resolve 解析聯絡人與對話（由 webhook.service 傳入，避免循環相依）
 */
export async function handleReferralEvent(
  ctx: InboundMessageContext,
  resolve: (ctx: InboundMessageContext) => Promise<void>,
): Promise<void> {
  const code = extractBindingCode(ctx.parsed.referralRef);
  const settings = code ? await getIdentityBindingSettingsCached(ctx.prisma, ctx.tenantId) : null;
  if (!code || !settings?.enabled) {
    logger.info('[Webhook] Referral event ignored', {
      channelId: ctx.channel.id,
      channelType: ctx.channel.channelType,
      ref: ctx.parsed.referralRef ?? null,
      reason: code ? 'binding_disabled' : 'not_binding_code',
    });
    return;
  }

  // 先解析聯絡人再寫去重 key：解析若失敗會往外拋讓平台重送，重送時不會被去重擋掉
  await resolve(ctx);
  if (!ctx.contactId || !ctx.conversation) return;
  if (!(await firstSeenReferral(ctx, code))) return;
  const status = await runBindingIntent(ctx, { kind: 'redeem', code });
  // 以 referral（例如 IG Icebreaker）第一次接觸、又沒有真的合併的新顧客，仍要收到招呼語
  if (status !== 'bound') await sendFirstContactGreeting(ctx);
}

async function findChannelIdentityId(ctx: InboundMessageContext): Promise<string | null> {
  const identity = await ctx.prisma.channelIdentity.findUnique({
    where: { channelId_uid: { channelId: ctx.channel.id, uid: ctx.contactUid } },
    select: { id: true },
  });
  return identity?.id ?? null;
}

async function runBindingIntent(
  ctx: InboundMessageContext,
  intent: Parameters<typeof executeBindingIntent>[3],
): Promise<string> {
  const conversation = ctx.conversation!;
  try {
    const identityId = await findChannelIdentityId(ctx);
    if (!identityId) throw new Error('找不到顧客的渠道身分');

    return await executeBindingIntent(
      ctx.prisma,
      { store: storeOverride ?? getBindingStore(), io: ctx.io },
      {
        tenantId: ctx.tenantId,
        channelId: ctx.channel.id,
        channelType: ctx.channel.channelType,
        channelIdentityId: identityId,
        uid: ctx.contactUid,
        contactId: ctx.contactId!,
        conversationId: conversation.id,
      },
      intent,
    );
  } catch (err) {
    // 失敗不能只寫 log：在對話留一則客服看得到的內部提示
    // err 放第二個參數才會帶出 message 與 stack（包在物件裡會被序列化成 {}）
    logger.error(`[Webhook] Identity binding failed (intent=${intent.kind}, conversation=${conversation.id}):`, err);
    try {
      const note = await ctx.prisma.message.create({
        data: {
          conversationId: conversation.id,
          direction: 'OUTBOUND',
          senderType: 'SYSTEM',
          contentType: 'system',
          content: { text: '跨渠道綁定處理失敗，顧客的綁定請求沒有完成，請協助確認。' },
          metadata: { type: 'identity_binding_error', intent: intent.kind },
          isRead: false,
        },
      });
      emitToConversationAndTenant(
        ctx.io,
        conversation.id,
        ctx.tenantId,
        'message.new',
        buildMessageNewPayload(note, { includeTypePayload: true }),
      );
    } catch (noteErr) {
      logger.error('[Webhook] Failed to record identity binding failure', noteErr);
    }
    return 'error';
  }
}
