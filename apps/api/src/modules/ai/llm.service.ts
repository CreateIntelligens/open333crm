/**
 * LLM Service — generates RAG replies via the per-tenant chat provider.
 *
 * Provider (Ollama / Gemini), model, temperature, max tokens, and system
 * prompts are all loaded from TenantSettings at call time. Defaults below
 * are used as fallback when a tenant's prompt fields are empty strings.
 */

import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import type { TenantDb } from '../../lib/tenant-db.js';
import { logger } from '@open333crm/core';
import { getChatProvider } from './providers/index.js';
import type { HistoryMessage } from './providers/index.js';
import type { TokenUsage } from './providers/types.js';
import { getPricing, calcCostUsd } from './pricing.service.js';
import { resolveGeminiKey } from './ai-key.service.js';
import {
  isMonthlyTokenExceeded,
  incrMonthlyTokens,
  checkQuotaThresholdCrossing,
} from '../trial/token-quota.service.js';
import { eventBus } from '../../events/event-bus.js';
import { getConfig } from '../../config/env.js';
import { AppError } from '../../shared/utils/response.js';
import { getChatSettings } from '../settings/chat-settings.service.js';

export type { HistoryMessage } from './providers/index.js';

/** AI 呼叫來源標記（AiUsage.feature） */
export type AiFeature =
  | 'kb-autoreply'
  | 'suggestion'
  | 'summary'
  | 'classify'
  | 'sentiment'
  | 'agent'
  | 'automation'
  | 'flex-generate'
  | 'ai-rewrite'
  | 'unknown';

export interface AiUsageMeta {
  feature: AiFeature;
  conversationId?: string;
  caseId?: string;
}

const ZERO_USAGE: TokenUsage = {
  promptTokens: 0,
  cachedTokens: 0,
  candidatesTokens: 0,
  thoughtsTokens: 0,
};

/**
 * 寫入一筆 AiUsage（fire-and-forget 的實體）。
 * 用量記錄是計費輔助非金流帳本：任何失敗只 log、絕不影響 AI 回覆主流程。
 */
export async function recordAiUsage(
  prisma: TenantDb,
  input: {
    tenantId: string;
    provider: string;
    model: string;
    keySource?: string;
    meta?: AiUsageMeta;
    usage?: TokenUsage;
    success: boolean;
    errorCode?: string;
  },
): Promise<void> {
  const usage = input.usage ?? ZERO_USAGE;
  const isByok = input.keySource === 'byok';
  // Ollama 本機模型 + BYOK（租戶自付）成本恆 0，不查價目表 / 不計平台成本
  const pricing =
    input.success && input.usage && input.provider !== 'ollama' && !isByok
      ? await getPricing(prisma, input.model)
      : null;
  const costUsd = input.success && input.usage && !isByok ? calcCostUsd(usage, pricing) : null;
  // BYOK 不查價目、不視為 usageMissing（成本本就不歸平台）
  const usageMissing =
    !input.usage || (input.success && input.provider !== 'ollama' && !isByok && !pricing);
  if (input.success && input.usage && input.provider !== 'ollama' && !isByok && !pricing) {
    logger.warn(`[AiUsage] no pricing found for model=${input.model}, costUsd recorded as 0`);
  }

  await prisma.aiUsage.create({
    data: {
      tenantId: input.tenantId,
      provider: input.provider,
      model: input.model,
      feature: input.meta?.feature ?? 'unknown',
      keySource: input.keySource ?? 'platform',
      promptTokens: usage.promptTokens,
      cachedTokens: usage.cachedTokens,
      candidatesTokens: usage.candidatesTokens,
      thoughtsTokens: usage.thoughtsTokens,
      totalTokens: usage.promptTokens + usage.candidatesTokens + usage.thoughtsTokens,
      costUsd: costUsd ?? new Prisma.Decimal(0),
      success: input.success,
      usageMissing: input.success ? usageMissing : false,
      errorCode: input.errorCode,
      conversationId: input.meta?.conversationId,
      caseId: input.meta?.caseId,
    },
  });

  // Redis 即時額度累加：只計成功、platform key 的 token（BYOK 租戶自付不計額度）
  const totalTokens = usage.promptTokens + usage.candidatesTokens + usage.thoughtsTokens;
  if (input.success && !isByok && totalTokens > 0) {
    // 累加後偵測是否剛跨越告警門檻（80%/100%），跨越則發事件；全程 fire-and-forget 不阻塞回覆
    incrMonthlyTokens(prisma, input.tenantId, totalTokens)
      .then(async (after) => {
        if (after === null || getConfig().USAGE_QUOTA_ALERTS_ENABLED !== 1) return;
        const crossed = await checkQuotaThresholdCrossing(prisma, input.tenantId, totalTokens, after);
        for (const c of crossed) {
          eventBus.publish({
            name: 'usage.quota.threshold',
            tenantId: input.tenantId,
            timestamp: new Date(),
            payload: {
              level: c.level,
              usedTokens: c.usedTokens,
              limitTokens: c.limitTokens,
              monthKey: c.monthKey,
            },
          });
        }
      })
      .catch((e) => logger.error('[TokenQuota] incr/alert failed:', e));
  }
}

/**
 * Default CRM customer-service system prompt. Used when a tenant has not
 * customized its chatSystemPrompt yet (empty string).
 */
export const CRM_REPLY_SYSTEM_PROMPT =
  '你是「Open333」品牌的專業客服助手，負責回答客戶關於家電產品（冰箱、洗衣機、冷氣、電視等）的問題。\n' +
  '請嚴格遵守以下規則：\n' +
  '【資訊來源限制 — 最重要】\n' +
  '1. 你只能根據「知識庫內容」回答。知識庫沒有提供的資訊，一律不可回答。\n' +
  '2. 對於型號、容量、材質、功率、規格、保固、價格、電話、門市地址等「具體事實」，' +
  '若知識庫中沒有明確記載，必須回答「這部分我幫您轉接專人為您確認」，' +
  '絕對不可自行推測、估算，或使用知識庫以外的知識來回答。\n' +
  '3. 回答前先確認：客戶詢問的「產品型號」是否與知識庫文章描述的產品一致。' +
  '若不一致（例如客戶問 A 產品、文章是 B 產品），不可套用該文章內容，請改為轉接專人。\n' +
  '4. 寧可說「我幫您轉接專人」，也不要給出不確定或可能錯誤的資訊。錯誤的產品/電話/地址資訊比沒有回答更嚴重。\n' +
  '【已提供資訊】\n' +
  '5. 回答前先檢視對話歷史。客戶已經提供過的資訊（如型號、故障狀況、購買管道），不可再次要求客戶提供。\n' +
  '【語氣與格式】\n' +
  '6. 全程使用繁體中文回覆，語氣親切專業\n' +
  '7. 回覆控制在 3-5 句話內，簡潔扼要\n' +
  '8. 遇到客訴、安全疑慮或緊急問題，建議客戶「我立刻為您轉接專人處理」\n' +
  '9. 結尾可適當加上「還有其他需要幫忙的嗎？」';

/**
 * Default conversation summarization system prompt.
 */
export const SUMMARIZE_SYSTEM_PROMPT =
  '你是一位客服系統的對話分析助手。請根據以下對話記錄，用繁體中文產生簡潔的對話摘要。' +
  '摘要應包含：客戶的主要問題或需求、目前的處理狀態、以及後續建議的行動。' +
  '請用 2-4 句話完成摘要，不要超過 200 字。';

/**
 * Default system prompt used when KB confidence is too low to answer directly.
 * The bot should ask a single clarifying question instead of guessing.
 */
export const CLARIFY_SYSTEM_PROMPT =
  '你是「Open333」品牌的客服助手。客戶剛剛的訊息資訊不足，無法判斷他真正的問題。' +
  '請參考前面的對話脈絡，用繁體中文禮貌地反問**一個**最關鍵的澄清問題以取得更多資訊。\n' +
  '規則：\n' +
  '1. **反問前必須先檢視整段對話歷史**。客戶已經提供過的資訊（型號、故障狀況、購買管道、購買日期等），' +
  '絕對不可再次詢問——重複詢問已知資訊會嚴重影響客戶體驗。\n' +
  '2. 若關鍵資訊其實都已具備，就不要再澄清，改為回覆「我幫您轉接專人為您服務」。\n' +
  '3. 只問一個問題，不要連珠炮\n' +
  '4. 問題要具體、可回答（避免「請問需要什麼幫助」這類空泛問句）\n' +
  '5. 如果是家電問題，且客戶「尚未」提供，才詢問：是哪個產品 / 故障狀況 / 型號\n' +
  '6. 整體控制在 2 句話以內\n' +
  '7. 不要編造或假設客戶的需求';

/**
 * Default system prompt used when the customer mentions a product model that
 * does NOT exist in the knowledge base (e.g. typo / wrong model code).
 * Instead of answering with a similar-but-wrong model's data, the bot should
 * tell the customer the model wasn't found and guide them to pick the correct
 * one from the list of related models we DO have.
 *
 * 相近型號清單會以 kbContext 的形式傳入（每行一個型號）。
 */
export const MODEL_GUIDE_SYSTEM_PROMPT =
  '你是「Open333」品牌的客服助手。客戶提到的產品「型號」在知識庫中查不到，' +
  '可能是輸入有誤或記錯型號。請用繁體中文引導客戶確認正確型號，規則如下：\n' +
  '1. 先客氣告知：這個型號我這邊查不到資料，想再幫您確認一下。\n' +
  '2. 若下方提供了「相近型號清單」，請把清單中的型號列出來，詢問客戶實際是哪一台' +
  '（例如：「我們的 11 人份電鍋有這些型號，您的是哪一台呢？」）。\n' +
  '3. 提醒客戶：型號通常印在產品本體底部的標籤，或外箱貼紙上，可以對照確認。\n' +
  '4. 絕對不可自行假設客戶是清單中的某一台、也不可拿相近型號的規格直接回答。\n' +
  '5. 不要編造清單以外的型號。若清單為空，只需請客戶提供／確認正確型號即可。\n' +
  '6. 語氣親切，整體控制在 3-4 句話內。';

type PromptKind = 'reply' | 'summarize';

/**
 * Generate a reply for a tenant. Uses tenant chat settings + system prompt.
 *
 * `promptKind` selects which system prompt to use:
 *   - 'reply'     → tenant.chatSystemPrompt    (fallback CRM_REPLY_SYSTEM_PROMPT)
 *   - 'summarize' → tenant.summarizeSystemPrompt (fallback SUMMARIZE_SYSTEM_PROMPT)
 *
 * `overrideSystemPrompt` lets callers (e.g. automation rules with custom
 * prompts) inject their own prompt without touching tenant defaults.
 */
export async function generateReply(
  prisma: TenantDb,
  tenantId: string,
  userMessage: string,
  kbContext = '',
  options: {
    promptKind?: PromptKind;
    overrideSystemPrompt?: string;
    history?: HistoryMessage[];
    /** 用量記錄的來源標記與關聯（未傳 feature 記為 unknown） */
    meta?: AiUsageMeta;
  } = {},
): Promise<string> {
  const settings = await getChatSettings(prisma, tenantId);
  const provider = getChatProvider(settings.provider);

  // BYOK：gemini 才需 key；取租戶自備 key（無則退回平台 env）
  const { key: apiKey, source: keySource } =
    provider.id === 'gemini'
      ? await resolveGeminiKey(prisma, tenantId)
      : { key: undefined, source: 'platform' as const };

  // 方案 token 月額度硬擋：達上限則擋 AI 回覆（真人回覆不受影響）。
  // 只在 keySource==='platform' 時檢查——與 incrMonthlyTokens 只累加 platform 的設計一致：
  // BYOK（租戶自備 key）成本租戶自付，不計額度也不擋；否則若租戶先前用 platform key
  // 累計到接近上限，之後切換成 BYOK 仍會被舊 platform 累計量誤擋。
  // 註：ollama 雖成本 0，但其 keySource 仍為 'platform' 且會被計入計數器，故此處一併受擋，
  // 保持與 dbMonthlyTokens/incrMonthlyTokens 的計數範圍一致。
  if (keySource === 'platform' && (await isMonthlyTokenExceeded(prisma, tenantId))) {
    throw new AppError('已達方案 AI 月額度上限', 'PLAN_LIMIT_EXCEEDED', 403, { limitKey: 'monthlyTokens' });
  }

  const promptKind = options.promptKind ?? 'reply';
  const systemPrompt =
    options.overrideSystemPrompt ??
    (promptKind === 'summarize'
      ? settings.summarizeSystemPrompt || SUMMARIZE_SYSTEM_PROMPT
      : settings.chatSystemPrompt || CRM_REPLY_SYSTEM_PROMPT);

  const usageBase = {
    tenantId,
    provider: provider.id,
    model: settings.model,
    keySource,
    meta: options.meta,
  };

  let result;
  try {
    result = await provider.generate({
      systemPrompt,
      userMessage,
      kbContext,
      history: options.history,
      model: settings.model,
      temperature: settings.temperature,
      maxTokens: settings.maxTokens,
      baseUrl: settings.baseUrl,
      apiKey,
    });
  } catch (err) {
    // 失敗呼叫也留帳（成本 0），並原樣 rethrow 保持既有錯誤行為
    recordAiUsage(prisma, {
      ...usageBase,
      success: false,
      errorCode: (err as Error).message?.slice(0, 200),
    }).catch((e) => logger.error('[AiUsage] failed to record error usage:', e));
    throw err;
  }

  // fire-and-forget：不 await、不阻塞回覆，寫入失敗只 log
  recordAiUsage(prisma, { ...usageBase, usage: result.usage, success: true }).catch((e) =>
    logger.error('[AiUsage] failed to record usage:', e),
  );

  return result.text;
}
