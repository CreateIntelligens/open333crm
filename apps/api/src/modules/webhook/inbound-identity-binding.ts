/**
 * 入站管線的跨渠道綁定攔截（change add-cross-channel-one-id，design D3 / D4）。
 *
 * 在首次打招呼訊息、其他 postback 攔截與 message.received（AI／關鍵字／自動化）之前執行；
 * 命中時仍推送 socket 事件，讓客服在收件匣看得到顧客送出的綁定訊息。
 */
import { logger } from '@open333crm/core';
import type { InboundMessageContext } from './inbound-message.types.js';
import { emitInboundSocketEvents } from './inbound-side-effects.js';
import { buildMessageNewPayload, emitToConversationAndTenant } from './inbound-socket-presenter.js';
import { extractBindingCode, getBindingStore, type BindingStore } from '../identity-binding/binding-code.js';
import {
  detectBindingIntent,
  executeBindingIntent,
  getIdentityBindingSettings,
} from '../identity-binding/identity-binding.service.js';

/** 測試可注入記憶體版儲存 */
let storeOverride: BindingStore | null = null;
export function setBindingStoreForTest(store: BindingStore | null): void {
  storeOverride = store;
}

/** 訊息文字或 FB／IG referral ref 中的綁定代碼 */
function codeFrom(ctx: InboundMessageContext): string | null {
  return extractBindingCode(ctx.parsed.referralRef) ?? extractBindingCode(ctx.textContent);
}

/**
 * 一般訊息（文字、postback）的綁定攔截。命中並處理完回 true，呼叫端應直接結束後續流程。
 */
export async function interceptIdentityBinding(ctx: InboundMessageContext): Promise<boolean> {
  if (!ctx.contactId || !ctx.conversation) return false;

  const intent = await detectBindingIntent(ctx.prisma, {
    tenantId: ctx.tenantId,
    contactId: ctx.contactId,
    text: ctx.textContent,
    code: codeFrom(ctx),
  });
  if (!intent) return false;

  if (ctx.message) await emitInboundSocketEvents(ctx);
  await runBindingIntent(ctx, intent);
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
  const settings = code ? await getIdentityBindingSettings(ctx.prisma, ctx.tenantId) : null;
  if (!code || !settings?.enabled) {
    logger.info('[Webhook] Referral event ignored', {
      channelId: ctx.channel.id,
      channelType: ctx.channel.channelType,
      ref: ctx.parsed.referralRef ?? null,
      reason: code ? 'binding_disabled' : 'not_binding_code',
    });
    return;
  }

  await resolve(ctx);
  if (!ctx.contactId || !ctx.conversation) return;
  await runBindingIntent(ctx, { kind: 'redeem', code });
}

async function runBindingIntent(
  ctx: InboundMessageContext,
  intent: Parameters<typeof executeBindingIntent>[3],
): Promise<void> {
  const conversation = ctx.conversation!;
  try {
    const identity = await ctx.prisma.channelIdentity.findUnique({
      where: { channelId_uid: { channelId: ctx.channel.id, uid: ctx.contactUid } },
      select: { id: true },
    });
    if (!identity) throw new Error('找不到顧客的渠道身分');

    await executeBindingIntent(
      ctx.prisma,
      { store: storeOverride ?? getBindingStore(), io: ctx.io },
      {
        tenantId: ctx.tenantId,
        channelId: ctx.channel.id,
        channelType: ctx.channel.channelType,
        channelIdentityId: identity.id,
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
  }
}
