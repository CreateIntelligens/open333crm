/**
 * 進站系統事件的分流（change fix-line-follow-unfollow-events，issue #362，design D1）。
 *
 * 渠道外掛把加好友、封鎖、群組加入離開、收回訊息等事件解析成 contentType 等於事件名稱的進站訊息
 * （目前只有 LINE 會送出）。收訊管線依這裡的判斷分流，不依渠道類型分支（AGENTS.md 結構規則 5）。
 */
import type { InboundMessageContext } from './inbound-message.types.js';

export const UNFOLLOW_CONTENT_TYPE = 'unfollow';

const SYSTEM_EVENT_CONTENT_TYPES: ReadonlySet<string> = new Set([
  'follow',
  UNFOLLOW_CONTENT_TYPE,
  'join',
  'leave',
  'memberJoined',
  'memberLeft',
  'unsend',
  'videoPlayComplete',
  'accountLink',
  'beacon',
]);

/** 是不是系統事件（不是顧客傳來的訊息或按鈕）：系統事件不觸發非營業時間的自動回覆 */
export function isSystemEventContentType(contentType: string): boolean {
  return SYSTEM_EVENT_CONTENT_TYPES.has(contentType);
}

/**
 * 封鎖事件、而且這個渠道查不到該 uid 的渠道身分（design D2）。
 * 這時不建立聯絡人與渠道身分：對方已封鎖，建了也聯絡不到，招呼語也一定送不出去。
 * 合併到其他渠道聯絡人的 uid 也一樣略過，不在合併的聯絡人下新建渠道身分。
 */
export async function isUnfollowFromUnknownIdentity(ctx: InboundMessageContext): Promise<boolean> {
  if (ctx.contentType !== UNFOLLOW_CONTENT_TYPE) return false;
  const identity = await ctx.prisma.channelIdentity.findFirst({
    where: { channelId: ctx.channel.id, uid: ctx.contactUid, contact: { tenantId: ctx.tenantId } },
    select: { id: true },
  });
  return identity === null;
}

/**
 * Canvas webhook 觸發比對用的事件類型（design D5）。回傳 null 表示這個事件不觸發任何流程。
 * - 封鎖：不觸發（對方已封鎖，流程送出的訊息一定失敗）
 * - 其他系統事件：與 contentType 相同（例如加好友是 'follow'）
 * - postback：'postback'；其他進站訊息：'message'
 */
export function canvasEventTypeOf(contentType: string): string | null {
  if (contentType === UNFOLLOW_CONTENT_TYPE) return null;
  if (isSystemEventContentType(contentType)) return contentType;
  if (contentType === 'postback') return 'postback';
  return 'message';
}
