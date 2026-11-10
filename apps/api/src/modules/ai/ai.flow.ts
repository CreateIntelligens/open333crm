/**
 * `ai` 模組呼叫 LLM 的 flow（change migrate-ai-llm-tenant-ctx，design D7）。
 *
 * 讀資料在交易內，呼叫 LLM 與向量化服務在交易外。LLM 失敗時各自降級：
 * 建議回覆改用文章內容、摘要改用固定格式、分類與情緒分析改用關鍵字判斷（不變）。
 */
import type { PrismaClient } from '@prisma/client';
import { logger } from '@open333crm/core';
import { inTenant } from '../../lib/tenant-ctx.js';
import { AppError } from '../../shared/utils/response.js';
import { searchArticlesByTextFlow } from '../embedding/embedding.flow.js';
import { readAiPrivacyPolicy, type AiPrivacyPolicy } from '../platform/ai-privacy.service.js';
import { generateReply, prepareLlmCall, runLlmCall, type LlmDeps, type PreparedLlmCall } from './llm.flow.js';
import { fallbackSummary, readConversationTranscript, readSuggestReplyQuery } from './ai.service.js';
import {
  CLASSIFY_SYSTEM_PROMPT,
  classifyByKeywords,
  parseClassifyReply,
  readCaseToClassify,
  setCaseCategoryIfUnset,
  type ClassifyResult,
} from './classify.service.js';
import { SENTIMENT_SYSTEM_PROMPT, parseSentimentReply, sentimentByKeywords, type SentimentResult } from './sentiment.service.js';
import { rewriteSystemPrompt, type RewriteAction } from './flex-ai.service.js';

/** `GET /ai/privacy/status`：只讀本租戶的政策 */
export function getAiPrivacyStatusFlow(deps: { prisma: PrismaClient }, tenantId: string): Promise<AiPrivacyPolicy> {
  return inTenant(deps.prisma, tenantId, (scope) => readAiPrivacyPolicy(scope.tx, scope.tenantId));
}

/**
 * `POST /ai/suggest-reply`：最新的顧客訊息 → 搜尋知識庫 → 每篇結果各產生一則建議。
 * 一次請求只呼叫一次 prepareLlmCall()；月額度已滿或 LLM 失敗時，該篇建議改用文章內容。
 */
export async function suggestReplyFlow(deps: LlmDeps, tenantId: string, conversationId: string) {
  try {
    const userText = await inTenant(deps.prisma, tenantId, (scope) => readSuggestReplyQuery(scope, conversationId));
    if (!userText) return { suggestions: [] };

    const results = await searchArticlesByTextFlow(deps, tenantId, userText);
    if (results.length === 0) return { suggestions: [] };

    let prepared: PreparedLlmCall | null = null;
    try {
      prepared = await prepareLlmCall(deps, tenantId);
    } catch (err) {
      logger.warn('[AI] suggestReply 無法呼叫 LLM，建議改用文章內容:', err);
    }

    const suggestions = await Promise.all(
      results.map(async (r) => {
        const kbContext = `【${r.title}】\n${(r.content || r.summary).slice(0, 1500)}`;
        let text: string;
        try {
          if (!prepared) throw new Error('LLM unavailable');
          text = await runLlmCall(deps, prepared, { userMessage: userText, kbContext }, { feature: 'suggestion', conversationId });
        } catch {
          // Fallback to article content/summary if LLM fails
          text = r.content || r.summary || r.title;
        }
        return {
          text,
          confidence: Math.round(r.similarity * 100) / 100,
          kmRefs: [{ id: r.id, title: r.title, url: `/dashboard/knowledge?id=${r.id}` }],
        };
      }),
    );
    return { suggestions };
  } catch (err) {
    logger.error('[AI] suggestReply error, returning empty:', err);
    return { suggestions: [] };
  }
}

/** `POST /ai/summarize` 與自動轉接的摘要。LLM 失敗時改用固定格式的摘要 */
export async function summarizeConversationFlow(deps: LlmDeps, tenantId: string, conversationId: string) {
  const transcript = await inTenant(deps.prisma, tenantId, (scope) => readConversationTranscript(scope, conversationId));
  if (!transcript) return { summary: '找不到對話記錄。' };
  try {
    const summary = await generateReply(deps, tenantId, transcript.transcript, '', {
      promptKind: 'summarize',
      meta: { feature: 'summary', conversationId },
    });
    return { summary };
  } catch (err) {
    logger.error('[AI] summarizeConversation LLM failed, using fallback:', err);
    return { summary: fallbackSummary(transcript) };
  }
}

/** `POST /ai/analyze-sentiment` 與自動化的情緒分析。LLM 失敗時改用關鍵字判斷，不丟錯 */
export async function analyzeSentimentFlow(deps: LlmDeps, tenantId: string, text: string): Promise<SentimentResult> {
  try {
    const raw = await generateReply(deps, tenantId, text, '', {
      overrideSystemPrompt: SENTIMENT_SYSTEM_PROMPT,
      meta: { feature: 'sentiment' },
    });
    return parseSentimentReply(raw, text);
  } catch (err) {
    logger.error('[Sentiment] LLM analysis failed, using keyword fallback:', err);
    return sentimentByKeywords(text);
  }
}

/** `POST /ai/classify` 與新工單的自動分類。LLM 失敗時改用關鍵字判斷，不丟錯 */
export async function classifyIssueFlow(deps: LlmDeps, tenantId: string, text: string): Promise<ClassifyResult> {
  try {
    const raw = await generateReply(deps, tenantId, text, '', {
      overrideSystemPrompt: CLASSIFY_SYSTEM_PROMPT,
      meta: { feature: 'classify' },
    });
    return parseClassifyReply(raw, text);
  } catch (err) {
    logger.error('[Classify] LLM classification failed, using keyword fallback:', err);
    return classifyByKeywords(text);
  }
}

/**
 * 新工單的自動分類：交易 1 讀工單分類與最新的顧客訊息 → 分類 → 交易 2 以「仍無分類」為條件寫入
 * （主規格「新工單的自動分類不覆蓋既有分類」）。回傳寫入的分類；不分類時回 null。
 */
export async function autoClassifyNewCaseFlow(
  deps: LlmDeps,
  tenantId: string,
  caseId: string,
  conversationId: string,
  classify: (deps: LlmDeps, tenantId: string, text: string) => Promise<ClassifyResult> = classifyIssueFlow,
): Promise<string | null> {
  const text = await inTenant(deps.prisma, tenantId, (scope) => readCaseToClassify(scope, caseId, conversationId));
  if (!text) return null;
  const result = await classify(deps, tenantId, text);
  await inTenant(deps.prisma, tenantId, (scope) => setCaseCategoryIfUnset(scope, caseId, result.category));
  logger.info(`[Classify] Case ${caseId} auto-classified: ${result.category} (confidence=${result.confidence})`);
  return result.category;
}

/** `POST /ai/rewrite`：對單一文字做 AI 潤稿 / 縮短 / 改語氣，回改寫後的純文字 */
export async function rewriteTextFlow(deps: LlmDeps, tenantId: string, text: string, action: RewriteAction): Promise<string> {
  try {
    const result = await generateReply(deps, tenantId, text, '', {
      overrideSystemPrompt: rewriteSystemPrompt(action),
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
