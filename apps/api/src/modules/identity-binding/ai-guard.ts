/**
 * 防止 AI 偽造綁定代碼（change add-cross-channel-one-id）。
 *
 * UAT 實測：顧客打錯綁定關鍵字（「綁定帳號綁定帳號」）時訊息交給 AI，AI 照著對話紀錄裡的
 * 綁定訊息編出一整則導流訊息，含不存在的代碼。顧客照做只會收到「代碼無效」，而且 AI 也可能
 * 編出錯的渠道或連結。兩層防護：
 *   1. 餵給 AI 的對話紀錄不含系統發的綁定訊息，其他訊息裡的代碼也遮掉，AI 沒有範本可抄
 *   2. AI 的回覆只要出現代碼，整則換成固定說明再送出（代碼只能由綁定流程產生）
 */
import { logger } from '@open333crm/core';
import type { TenantDb } from '../../lib/tenant-db.js';
import type { IdentityBindingSettings } from './binding-links.js';
import { getIdentityBindingSettingsCached } from './identity-binding.service.js';

/** 寬鬆比對：AI 編的代碼長度、大小寫不一定正確，也可能藏在網址編碼裡；前面接英文字母的（如 REBIND-）不算 */
const LOOSE_CODE_PATTERN = /(?<![A-Za-z])BIND-[0-9A-Za-z]{4,}/gi;
const REDACTED = '[綁定代碼]';
/** email 登記連結（change add-email-identity-merge）：連結即憑證，不給 AI 看也不讓 AI 照抄 */
const EMAIL_LINK_PATTERN = /\S*\/bind\/email\/[A-Za-z0-9_-]+/g;
const REDACTED_EMAIL_LINK = '[登記連結]';
const BINDING_MESSAGE_SOURCE = 'identity_binding';

/**
 * 讀對話紀錄時多取的倍數：綁定訊息過濾掉之後仍留得滿歷史上限。
 * 綁定代碼每個身分每小時最多申請 5 組，最近的訊息幾乎不可能大半都是綁定訊息，固定倍數已足夠，不需分頁讀取。
 */
export const AI_HISTORY_FETCH_FACTOR = 3;

export function containsBindingCode(text: string): boolean {
  return new RegExp(LOOSE_CODE_PATTERN.source, 'i').test(text);
}

function redactBindingCodes(text: string): string {
  return text.replace(LOOSE_CODE_PATTERN, REDACTED).replace(EMAIL_LINK_PATTERN, REDACTED_EMAIL_LINK);
}

export interface HistoryRow {
  direction: string;
  content: unknown;
  metadata: unknown;
}

/** 對話紀錄轉成 AI 的歷史訊息：去掉系統發的綁定訊息、遮掉代碼、略過沒有文字的訊息 */
export function toAiHistory(rows: HistoryRow[]): Array<{ role: 'user' | 'assistant'; content: string }> {
  return rows.flatMap((row) => {
    if ((row.metadata as { source?: unknown } | null)?.source === BINDING_MESSAGE_SOURCE) return [];
    const text =
      typeof row.content === 'object' && row.content !== null ? ((row.content as { text?: unknown }).text ?? '') : '';
    if (typeof text !== 'string' || !text) return [];
    return [{ role: row.direction === 'INBOUND' ? ('user' as const) : ('assistant' as const), content: redactBindingCodes(text) }];
  });
}

/** AI 回覆含代碼時整則換掉（不只刪掉代碼：連結、渠道名稱也可能是編的） */
export function guardAiReply(text: string, settings: IdentityBindingSettings): { text: string; blocked: boolean } {
  if (!containsBindingCode(text)) return { text, blocked: false };
  const keyword = settings.bindKeywords[0];
  return {
    text:
      settings.enabled && keyword
        ? `如需綁定其他帳號，請直接傳送「${keyword}」，系統會提供專屬的綁定連結與代碼。`
        : '目前無法在這裡綁定帳號，如需協助請洽客服人員。',
    blocked: true,
  };
}

/**
 * AI 回覆送出前的把關：讀租戶綁定設定決定替代說明，攔截時留 warn log。
 * 呼叫端要把 blocked 寫進訊息 metadata（bindingCodeBlocked），客服在對話紀錄看得到被換掉的回覆。
 */
export async function guardAiReplyForTenant(
  db: TenantDb,
  tenantId: string,
  text: string,
  context: { conversationId?: string; source: string },
): Promise<{ text: string; blocked: boolean }> {
  if (!containsBindingCode(text)) return { text, blocked: false };
  const settings = await getIdentityBindingSettingsCached(db, tenantId);
  const guarded = guardAiReply(text, settings);
  logger.warn('[IdentityBinding] AI 回覆含綁定代碼，已換成固定說明', { tenantId, ...context });
  return guarded;
}
