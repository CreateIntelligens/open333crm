/**
 * flex-ai.service — AI 生成 / 潤稿 LINE Flex 內容
 *
 * 兩個能力：
 *   • generateFlexFromPrompt：一句話描述 → AI 產合法 LINE Flex bubble → 進填空編輯器
 *   • rewriteText：對單一文字欄位做 AI 潤稿（改語氣 / 縮短 / 潤飾）
 *
 * 設計要點（見 openspec/changes/flex-ai-generate/design.md）：
 *   - 走既有 llm.service.generateReply，token 額度硬擋 / 累加 / provider 選擇皆自動生效，
 *     本檔不重複呼叫額度函式。
 *   - 生成產出必經 validateLineFlexDraft（實打 LINE API）保證合法；不合法把 LINE 錯誤
 *     訊息餵回 AI 重試一次，再不行回錯誤建議改用範本（不硬塞壞 JSON 進編輯器）。
 */

import type { TenantDb } from '../../lib/tenant-db.js';
import { AppError } from '../../shared/utils/response.js';
import { generateReply } from './llm.service.js';
import { validateLineFlexDraft } from '../marketing/material.service.js';

/** 給 AI 的 few-shot：一個精簡但合法的單 bubble（商品促銷版型）。 */
const FEW_SHOT_BUBBLE = {
  type: 'bubble',
  hero: {
    type: 'image',
    url: 'https://developers-resource.landpress.line.me/fx/img/01_1_cafe.png',
    size: 'full',
    aspectRatio: '20:13',
    aspectMode: 'cover',
  },
  body: {
    type: 'box',
    layout: 'vertical',
    contents: [
      { type: 'text', text: '本週新品上市', weight: 'bold', size: 'xl' },
      { type: 'text', text: '嚴選食材，限時優惠中', size: 'sm', color: '#999999', wrap: true, margin: 'md' },
      { type: 'text', text: 'NT$ 1,290', weight: 'bold', size: 'lg', margin: 'lg' },
    ],
  },
  footer: {
    type: 'box',
    layout: 'vertical',
    spacing: 'sm',
    contents: [
      {
        type: 'button',
        style: 'primary',
        height: 'sm',
        action: { type: 'uri', label: '立即購買', uri: 'https://example.com' },
      },
    ],
  },
};

const FLEX_SYSTEM_PROMPT = [
  '你是 LINE Flex Message 設計助手。使用者會用一句話描述想要的訊息卡片，',
  '你要產出「一個」合法的 LINE Flex bubble JSON。嚴格遵守：',
  '1. 只輸出 JSON 本身，不要有任何說明文字、markdown 標記或 ```json 圍欄。',
  '2. 根節點必須是 { "type": "bubble", ... }（單一 bubble，不要 carousel、不要包 { type:"flex" }）。',
  '3. 結構盡量簡單：常見為 hero(image) + body(vertical box 內含 text) + footer(button)。',
  '4. 圖片 url 用 https 佔位圖（如 https://placehold.co/1024x682.png）；按鈕 action 用 type:"uri"、uri 用 https://example.com 佔位，label 貼合情境。',
  '5. 文字內容用繁體中文，貼合使用者描述的情境（標題、說明、價格、按鈕文字等）。',
  '6. 不要用外部字型、影片、或超出單 bubble 的複雜巢狀。',
  '',
  '範例輸出（格式參考，實際內容依使用者描述調整）：',
  JSON.stringify(FEW_SHOT_BUBBLE),
].join('\n');

export type RewriteAction = 'polish' | 'shorten' | 'tone';

const REWRITE_INSTRUCTION: Record<RewriteAction, string> = {
  polish: '潤飾下面這段文字，讓它更通順、專業、有吸引力，保持原意與長度相近。',
  shorten: '把下面這段文字精簡變短，保留核心訊息，適合放進訊息卡片的有限空間。',
  tone: '把下面這段文字改寫成更親切、活潑的行銷語氣，保持原意。',
};

/** 從 AI 回應抽出第一個 JSON 物件（容錯 markdown 圍欄 / 前後多餘文字）。 */
function extractJsonObject(raw: string): unknown {
  const trimmed = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/,'').trim();
  // 先試整段直接 parse
  try {
    return JSON.parse(trimmed);
  } catch {
    // 退而求其次：抓第一個 { 到最後一個 } 的區塊
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) {
      throw new AppError('AI 未產出可解析的 JSON', 'FLEX_AI_PARSE_FAILED', 422);
    }
    return JSON.parse(trimmed.slice(start, end + 1));
  }
}

export interface GeneratedFlex {
  contents: Record<string, unknown>;
  altText: string;
}

/**
 * 一句話描述 → 合法 LINE Flex bubble body。
 * 產出經 validateLineFlexDraft 驗證；不合法把 LINE 錯誤餵回重試一次，
 * 仍失敗則 throw AppError（建議改用範本）。
 */
export async function generateFlexFromPrompt(
  prisma: TenantDb,
  tenantId: string,
  prompt: string,
): Promise<GeneratedFlex> {
  const altText = prompt.slice(0, 60);

  const attempt = async (userMessage: string): Promise<GeneratedFlex> => {
    const raw = await generateReply(prisma, tenantId, userMessage, '', {
      overrideSystemPrompt: FLEX_SYSTEM_PROMPT,
      meta: { feature: 'flex-generate' },
    });
    const parsed = extractJsonObject(raw);
    // 經既有 LINE validate（實打 LINE API）保證合法；不合法會 throw AppError。
    const { body } = await validateLineFlexDraft(prisma, tenantId, parsed, { altText });
    return { contents: body.contents, altText: body.altText };
  };

  try {
    return await attempt(prompt);
  } catch (firstError) {
    // 解析或驗證失敗 → 把錯誤訊息餵回 AI 修正一次
    const reason = firstError instanceof AppError ? firstError.message : String(firstError);
    try {
      return await attempt(
        `${prompt}\n\n（上一版產出不合法，錯誤：${reason}。請依此修正後重新輸出合法的 Flex bubble JSON。）`,
      );
    } catch {
      throw new AppError(
        'AI 產出的 Flex 內容無法通過 LINE 驗證，請調整描述或改用精選範本。',
        'FLEX_AI_GENERATE_FAILED',
        422,
      );
    }
  }
}

/** 對單一文字做 AI 潤稿 / 縮短 / 改語氣。回改寫後的純文字。 */
export async function rewriteText(
  prisma: TenantDb,
  tenantId: string,
  text: string,
  action: RewriteAction,
): Promise<string> {
  const systemPrompt = [
    REWRITE_INSTRUCTION[action],
    '只輸出改寫後的文字本身，不要加引號、說明或多餘標點。輸出繁體中文。',
  ].join('\n');

  try {
    const result = await generateReply(prisma, tenantId, text, '', {
      overrideSystemPrompt: systemPrompt,
      meta: { feature: 'ai-rewrite' },
    });
    return result.trim();
  } catch (error) {
    // 額度硬擋（PLAN_LIMIT_EXCEEDED）等 AppError 原樣往上；其餘（如 provider 呼叫失敗）
    // 包成明確的 422，避免裸 500 污染 log。潤稿是輔助功能，前端失敗時靜默略過。
    if (error instanceof AppError) throw error;
    throw new AppError('AI 潤稿暫時無法使用，請稍後再試。', 'AI_REWRITE_FAILED', 422);
  }
}
