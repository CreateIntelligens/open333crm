/**
 * AI 回覆時提供同一位聯絡人在其他渠道的近期訊息（change add-email-identity-merge，design D10）。
 *
 * 以獨立的系統指示區塊提供，不和目前對話的 user／assistant turn 交錯：交錯會讓模型以為那些回覆
 * 是在這個渠道說的。一律以「聯絡人目前擁有的對話」查詢，合併解除、對話搬回原聯絡人後自然讀不到。
 */
import type { TenantDb } from '../../lib/tenant-db.js';
import { AI_HISTORY_FETCH_FACTOR, toAiHistory } from '../identity-binding/ai-guard.js';
import { channelLabel } from '../identity-binding/binding-links.js';

export const OTHER_CHANNEL_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
export const OTHER_CHANNEL_LIMIT = 10;

export const OTHER_CHANNEL_RULE =
  '以下是同一位顧客最近在其他渠道的訊息，只用來理解顧客的問題與背景，不要說成是在這段對話裡講的。' +
  '回覆時不主動複述其中的電話、地址、email、訂單或會員編號；顧客在這段對話自己提到的除外。';

function ago(ms: number): string {
  const minutes = Math.max(1, Math.floor(ms / 60000));
  if (minutes < 60) return `${minutes} 分鐘前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小時前`;
  return `${Math.floor(hours / 24)} 天前`;
}

/** 回傳要附在系統指示後面的文字；沒有其他渠道的訊息時回空字串 */
export async function loadOtherChannelContext(
  db: TenantDb,
  tenantId: string,
  conversationId: string,
  now: number = Date.now(),
): Promise<string> {
  const current = await db.conversation.findFirst({ where: { id: conversationId, tenantId }, select: { contactId: true } });
  if (!current) return '';

  const rows = await db.message.findMany({
    where: {
      conversation: { tenantId, contactId: current.contactId, id: { not: conversationId } },
      createdAt: { gte: new Date(now - OTHER_CHANNEL_WINDOW_MS) },
    },
    orderBy: { createdAt: 'desc' },
    // 多取一些：綁定與登記訊息過濾掉之後，仍要留滿上限
    take: OTHER_CHANNEL_LIMIT * AI_HISTORY_FETCH_FACTOR,
    select: { direction: true, content: true, metadata: true, createdAt: true, conversation: { select: { channelType: true } } },
  });

  const lines = rows
    .flatMap((row) =>
      toAiHistory([row]).map((m) => `[${channelLabel(row.conversation.channelType)} ${ago(now - row.createdAt.getTime())}] ${m.role === 'user' ? '顧客' : '客服'}：${m.content}`),
    )
    .slice(0, OTHER_CHANNEL_LIMIT)
    .reverse();
  return lines.length > 0 ? `${OTHER_CHANNEL_RULE}\n${lines.join('\n')}` : '';
}

/** 把其他渠道的區塊接在系統指示後面 */
export function withOtherChannelContext(systemPrompt: string, otherChannelContext: string): string {
  return otherChannelContext ? `${systemPrompt}\n\n${otherChannelContext}` : systemPrompt;
}
