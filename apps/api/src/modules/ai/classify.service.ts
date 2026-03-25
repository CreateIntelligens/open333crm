/**
 * Issue Classification Service — uses Ollama LLM to categorize customer issues.
 */

import { generateReply } from './llm.service.js';

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

const CLASSIFY_SYSTEM_PROMPT =
  '你是一位客服問題分類助手。根據客戶訊息內容，將其分類到以下類別之一：' +
  CATEGORIES.join('、') + '。' +
  '請以 JSON 格式回覆：{"category":"類別名稱","subcategory":"子分類(可選)","confidence":0到1的數字}。' +
  '只回覆 JSON，不要有其他文字。';

/**
 * Keyword-based fallback when LLM response is invalid.
 */
function keywordFallback(text: string): ClassifyResult {
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

export async function classifyIssue(text: string): Promise<ClassifyResult> {
  try {
    const raw = await generateReply(CLASSIFY_SYSTEM_PROMPT, text, '');

    const jsonMatch = raw.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      const category = CATEGORIES.includes(parsed.category)
        ? parsed.category
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

    return keywordFallback(text);
  } catch (err) {
    console.error('[Classify] LLM classification failed, using keyword fallback:', err);
    return keywordFallback(text);
  }
}
