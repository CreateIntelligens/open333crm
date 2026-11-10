/**
 * Issue Classification Service — 解析 LLM 的分類結果、關鍵字降級，以及新工單自動分類的讀寫。
 * 呼叫 LLM 在 ai.flow.ts（change migrate-ai-llm-tenant-ctx，design D7）。
 */

import type { TenantCtx } from '../../lib/tenant-ctx.js';

export interface ClassifyResult {
  category: string;
  subcategory?: string;
  confidence: number; // 0 to 1
}

const CATEGORIES = [
  '產品諮詢',
  '訂單問題',
  '退換貨',
  '帳號問題',
  '技術支援',
  '投訴建議',
  '付款問題',
  '物流配送',
  '其他',
] as const;

export const CLASSIFY_SYSTEM_PROMPT =
  '你是一位客服問題分類助手。根據客戶訊息內容，將其分類到以下類別之一：' +
  CATEGORIES.join('、') + '。' +
  '請以 JSON 格式回覆：{"category":"類別名稱","subcategory":"子分類(可選)","confidence":0到1的數字}。' +
  '只回覆 JSON，不要有其他文字。';

/**
 * Keyword-based fallback when LLM response is invalid.
 */
export function classifyByKeywords(text: string): ClassifyResult {
  const lower = text.toLowerCase();

  const categoryKeywords: Record<string, string[]> = {
    '退換貨': ['退貨', '換貨', '退款', '退費', '退回', '更換', '不要了'],
    '訂單問題': ['訂單', '下單', '出貨', '訂購', '取消訂單', '修改訂單'],
    '付款問題': ['付款', '支付', '刷卡', '轉帳', '金額', '扣款', '繳費', '信用卡'],
    '物流配送': ['運送', '配送', '寄送', '物流', '快遞', '收到', '到貨', '包裹'],
    '帳號問題': ['帳號', '密碼', '登入', '註冊', '帳戶', '會員', '忘記密碼'],
    '技術支援': ['錯誤', '當機', 'bug', '無法', '故障', '問題', '不能用', '閃退'],
    '投訴建議': ['投訴', '客訴', '建議', '不滿', '意見', '檢舉'],
    '產品諮詢': ['價格', '規格', '功能', '尺寸', '顏色', '材質', '商品', '產品'],
  };

  for (const [category, keywords] of Object.entries(categoryKeywords)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) {
        return { category, confidence: 0.5 };
      }
    }
  }

  return { category: '其他', confidence: 0.3 };
}

/** 解析 LLM 的回覆；不是合法的 JSON 時改用關鍵字判斷 */
export function parseClassifyReply(raw: string, text: string): ClassifyResult {
  const jsonMatch = raw.match(/\{[\s\S]*?\}/);
  if (!jsonMatch) return classifyByKeywords(text);
  let parsed: { category?: unknown; subcategory?: unknown; confidence?: unknown };
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return classifyByKeywords(text);
  }
  const category = CATEGORIES.includes(parsed.category as (typeof CATEGORIES)[number])
    ? (parsed.category as string)
    : '其他';
  const confidence = typeof parsed.confidence === 'number'
    ? Math.max(0, Math.min(1, parsed.confidence))
    : 0.5;
  return {
    category,
    subcategory: typeof parsed.subcategory === 'string' ? parsed.subcategory : undefined,
    confidence,
  };
}

/**
 * 新工單的自動分類要分類的文字：對話最新的顧客訊息。
 * 工單已有分類（客服手動選的、或自動化規則指定的）就回 null，不分類、不覆蓋。
 * 原本收到 case.created 一定分類並覆寫，手動選的分類會被 AI 結果蓋掉。
 */
export async function readCaseToClassify(ctx: TenantCtx, caseId: string, conversationId: string): Promise<string | null> {
  const current = await ctx.tx.case.findFirst({ where: { id: caseId, tenantId: ctx.tenantId }, select: { category: true } });
  // null 才是「沒有分類」；空字串（舊路由可存入）也視為已處理，否則會白白呼叫 AI 卻寫不回去
  if (!current || current.category !== null) return null;
  const latest = await ctx.tx.message.findFirst({
    where: { conversationId, conversation: { tenantId: ctx.tenantId }, direction: 'INBOUND' },
    orderBy: { createdAt: 'desc' },
    select: { content: true },
  });
  const text = (latest?.content as Record<string, unknown> | null)?.text;
  return typeof text === 'string' && text ? text : null;
}

/** 寫入時再以「仍無分類」為條件：分類期間客服選了分類就不覆蓋 */
export async function setCaseCategoryIfUnset(ctx: TenantCtx, caseId: string, category: string): Promise<void> {
  await ctx.tx.case.updateMany({ where: { id: caseId, tenantId: ctx.tenantId, category: null }, data: { category } });
}
