/**
 * KB Auto-Reply Service
 *
 * When an inbound message arrives in a BOT_HANDLED conversation, decide what
 * to do based on KB similarity tiers:
 *   >= 0.80               — direct LLM reply grounded in KB
 *   threshold–0.80        — LLM reply grounded in KB + handoff prompt appended
 *   < threshold (or no KB)— **clarify**: ask one question to gather more info,
 *                           bounded by clarifyMaxAttempts (then handoff)
 *
 * 追問用完或追問的 LLM 呼叫失敗時，回覆「已為您轉接客服人員」並在同一個交易真的轉接
 * （handOffConversation，與自動轉接共用；issue #419）。
 * 因錯誤沒有回覆時回傳 failed（KbAutoReplyResult），由 automation.worker 轉接真人（issue #445）。
 *
 * 這個檔案放回覆內容的判斷與收 TenantCtx 的查詢；交易、embedding、LLM 與送出在
 * kb-autoreply.flow.ts（change migrate-ai-kb-autoreply-tenant-ctx）。
 *
 * The LLM now receives the recent conversation history (last 10 messages) so
 * follow-up turns make sense and clarification questions don't repeat earlier
 * answers.
 */

import type { Prisma } from '@prisma/client';
import { getConfig } from '../../config/env.js';
import { readEmbeddingInputs, searchSimilarArticles, type ArticleSearchResult } from '../embedding/embedding.service.js';
import type { EmbeddingSettings } from '../settings/embedding-settings.service.js';
import type { TenantCtx } from '../../lib/tenant-ctx.js';
import { getChatSettings, type ChatSettings } from '../settings/chat-settings.service.js';
import type { HistoryMessage } from './llm.service.js';
import { detectModels, isKnownModel, findRelatedModels, hasKnownPrefix } from './model-matcher.js';
import { getKnownModelKeys } from './model-registry.service.js';
import { loadOtherChannelContext } from './other-channel-context.js';
import { AI_HISTORY_FETCH_FACTOR, toAiHistory } from '../identity-binding/ai-guard.js';
import {
  DEFAULT_BOT_CONFIG,
  DEFAULT_HANDOFF_PROMPT_TEXT,
  type BotConfig,
} from '@open333crm/automation';
import { hasMatchingKeywordRule } from '../automation/keyword-yield.js';
import { logger } from '@open333crm/core';
import { AppError } from '../../shared/utils/response.js';
import type { AiPrivacyPolicy } from '../platform/ai-privacy.service.js';

export const CLARIFY_HANDOFF_FALLBACK =
  '不好意思我這邊還沒辦法判斷您的需求，已為您轉接客服人員，請稍候。';
const HISTORY_LIMIT = 10;

/** 追問用完、或追問的 LLM 呼叫失敗時寫進 handoffReason 的原因（客服看得到為什麼轉接） */
export function clarifyExhaustedReason(attempts: number, max: number): string {
  return `知識庫找不到可回答的內容，追問次數已達上限（${attempts}/${max}）`;
}
export function clarifyLlmFailedReason(err: unknown): string {
  return aiErrorCause(err) === AI_ERROR_CAUSES.PLAN_LIMIT_EXCEEDED
    ? 'AI 月額度已用完，無法自動回覆'
    : 'AI 回覆失敗，無法自動追問';
}

/** 錯誤種類 → 客服看得懂的原因。錯誤訊息不寫進原因：可能含供應商回應或內部網址 */
const AI_ERROR_CAUSES: Record<string, string> = {
  AI_DEIDENTIFICATION_UNAVAILABLE: '去識別化服務無法使用',
  AI_PRIVACY_POLICY_UNAVAILABLE: '個資保護設定無法讀取',
  PLAN_LIMIT_EXCEEDED: 'AI 月額度已用完',
};
function aiErrorCause(err: unknown): string | undefined {
  return err instanceof AppError ? AI_ERROR_CAUSES[err.code] : undefined;
}

/**
 * agent 沒有回覆、知識庫回覆又因錯誤失敗時的轉接原因（issue #445）。
 * 先看知識庫的錯誤，是一般錯誤時再看 agent 丟出的錯誤
 */
export function aiReplyFailedReason(kbError: unknown, agentError?: unknown): string {
  const cause = aiErrorCause(kbError) ?? aiErrorCause(agentError) ?? 'AI 服務發生錯誤';
  return `AI 暫時無法回覆（${cause}）`;
}

/**
 * kbContext 字數預算：避免單篇硬截把答案尾段切掉，同時控制總長不撐爆 LLM context。
 * 單篇上限提高到 3000（原本 1500），全部文章合計不超過 8000。
 */
const KB_PER_ARTICLE_LIMIT = 3000;
const KB_TOTAL_CONTEXT_LIMIT = 8000;

/**
 * 把 KB 檢索結果組成 grounding context（總預算制）。
 * 逐篇加入，單篇截到 KB_PER_ARTICLE_LIMIT，累計到 KB_TOTAL_CONTEXT_LIMIT 為止。
 */
export function buildKbContext(
  results: Array<{ title: string; content: string; summary: string }>,
): string {
  const parts: string[] = [];
  let used = 0;
  for (let i = 0; i < results.length; i++) {
    if (used >= KB_TOTAL_CONTEXT_LIMIT) break;
    const r = results[i];
    const body = (r.content || r.summary || '').slice(0, KB_PER_ARTICLE_LIMIT);
    const remaining = KB_TOTAL_CONTEXT_LIMIT - used;
    const clipped = body.slice(0, remaining);
    parts.push(`【文章${i + 1}】${r.title}\n${clipped}`);
    used += clipped.length;
  }
  return parts.join('\n\n');
}

/**
 * 型號守門「高相似度豁免」門檻。
 * 客戶提到的型號雖不在白名單，但若 KB 相似度 >= 此值，視為「白名單可能慢半拍、
 * 但 KB 其實有對應文章」，仍放行走正常 KB 回答，避免誤擋剛新增的型號。
 */
const MODEL_GUARD_EXEMPT_SIMILARITY = 0.85;

/**
 * 知識庫自動回覆的結果（issue #445）。呼叫端以 failed 判斷要不要轉接真人：
 * - replied：已寫入並送出回覆（含型號守門、追問、「已為您轉接」與 LLM 失敗時的文章內容）
 * - skipped：正常的不回覆，不是失敗，不轉接
 * - failed：因錯誤沒有回覆（例如 embedding 或去識別化服務失敗）。這個函式丟出的錯誤（ClaimTransactionError 以外）也是失敗
 */
export type KbAutoReplySkipReason =
  | 'kb_disabled'
  | 'not_bot_handled'
  | 'keyword_rule'
  | 'bot_mode'
  /** 寫入時認領不到（別的處理已回覆），或要轉接時對話已不是 BOT_HANDLED */
  | 'already_handled';
export type KbAutoReplyResult =
  | { status: 'replied' }
  | { status: 'skipped'; reason: KbAutoReplySkipReason }
  | { status: 'failed'; error: unknown };

export const skipped = (reason: KbAutoReplySkipReason): KbAutoReplyResult => ({ status: 'skipped', reason });

export type ReplyKind =
  | 'kb_high_confidence'
  | 'kb_with_handoff'
  | 'clarify'
  | 'clarify_handoff'
  | 'model_not_found';


/** 處理開始時讀到的資料（readKbReplyContext） */
export interface KbReplyContext {
  channelId: string;
  botConfig: BotConfig;
  chatSettings: ChatSettings;
  history: HistoryMessage[];
  otherChannelContext: string;
  embeddingSettings: EmbeddingSettings;
  /** 遮罩政策：向量化、遮罩回覆都用這一份（design D4） */
  policy: AiPrivacyPolicy;
  /** 處理開始時的追問次數（追問與型號守門共用） */
  prevAttempts: number;
}

/** channel.settings.botConfig 的完整設定。空字串、不合法的 enum 改回預設值（spread 只對 undefined 退回預設） */
function resolveBotConfig(channelSettings: unknown): BotConfig {
  const settings = (channelSettings || {}) as Record<string, unknown>;
  const rawBotConfig = (settings.botConfig || {}) as Partial<BotConfig>;
  const merged: BotConfig = { ...DEFAULT_BOT_CONFIG, ...rawBotConfig };
  return {
    ...merged,
    handoffPromptStyle: (['text', 'button', 'both', 'none'] as const).includes(merged.handoffPromptStyle)
      ? merged.handoffPromptStyle
      : DEFAULT_BOT_CONFIG.handoffPromptStyle,
    handoffButtonLabel:
      typeof merged.handoffButtonLabel === 'string' && merged.handoffButtonLabel.trim().length > 0
        ? merged.handoffButtonLabel
        : DEFAULT_BOT_CONFIG.handoffButtonLabel,
  };
}

/**
 * 交易 A（design D1 步驟 1）：判斷要不要回覆，並讀回覆需要的資料。只讀，不呼叫外部服務。
 * 回傳略過原因時不再讀之後的資料。
 */
export async function readKbReplyContext(
  ctx: TenantCtx,
  conversationId: string,
  messageText: string,
): Promise<{ skip: KbAutoReplySkipReason } | KbReplyContext> {
  if (!getConfig().KB_AUTO_REPLY_ENABLED) return { skip: 'kb_disabled' };
  const { tenantId } = ctx;

  const conversation = await ctx.tx.conversation.findFirst({
    where: { id: conversationId, tenantId, status: 'BOT_HANDLED' },
    select: {
      contactId: true,
      metadata: true,
      channel: { select: { id: true, channelType: true, settings: true } },
    },
  });
  if (!conversation) return { skip: 'not_bot_handled' };

  // 若有 keyword.matched 規則命中此訊息、且能在這個渠道回覆，讓步給 keyword 規則處理：
  // 一則訊息只回一次，命中關鍵字的訊息不算追問、也不會因追問用完而轉接（#419）。
  // 關鍵字規則由 workers 執行，不看對話狀態，所以轉接成 AGENT_HANDLED 之後關鍵字規則照樣回覆。
  // 規則送不到這個渠道時照常回覆，否則顧客什麼都收不到（change fix-keyword-yield-ig-delivery）
  if (
    await hasMatchingKeywordRule(ctx.tx, tenantId, messageText, conversation.channel.channelType, {
      conversationId,
      contactId: conversation.contactId,
    })
  ) {
    logger.info(`[KbAutoReply] conv=${conversationId} skipped: keyword rule will handle`);
    return { skip: 'keyword_rule' };
  }

  const botConfig = resolveBotConfig(conversation.channel.settings);
  if (botConfig.botMode === 'off' || botConfig.botMode === 'keyword') return { skip: 'bot_mode' };

  const chatSettings = await getChatSettings(ctx);
  // 對話歷史不含正在回覆的這則進站訊息
  const history = await loadKbHistory(ctx, conversationId);
  // 歸戶後同一位顧客在其他渠道問過的內容（change add-email-identity-merge）
  const otherChannelContext = await loadOtherChannelContext(ctx, conversationId);
  // 一次處理只讀一次向量化設定與遮罩政策（change migrate-embedding-tenant-ctx，design D5）
  const { settings: embeddingSettings, policy } = await readEmbeddingInputs(ctx);

  const convMeta = (conversation.metadata ?? {}) as Record<string, unknown>;
  return {
    channelId: conversation.channel.id,
    botConfig,
    chatSettings,
    history,
    otherChannelContext,
    embeddingSettings,
    policy,
    prevAttempts: Number(convMeta.clarifyAttempts ?? 0),
  };
}

export interface KbSearchResult {
  results: ArticleSearchResult[];
  topResult: ArticleSearchResult | undefined;
  topSimilarity: number;
  /** 型號守門：有值時要引導客人確認型號 */
  modelGuard: { unknownModel: string; relatedModels: string[] } | null;
}

/** 交易 B（design D1 步驟 3）：搜尋知識庫，型號守門需要時讀型號白名單 */
export async function searchKbArticles(
  ctx: TenantCtx,
  input: { conversationId: string; messageText: string; embedding: number[]; settings: EmbeddingSettings },
): Promise<KbSearchResult> {
  const results = await searchSimilarArticles(ctx, input.embedding, {
    topK: input.settings.topK,
    threshold: input.settings.threshold,
  });
  const topResult = results[0];
  const topSimilarity = topResult?.similarity ?? 0;
  logger.info(
    `[KbAutoReply] conv=${input.conversationId} kbResults=${results.length} topSim=${topSimilarity.toFixed(3)}`,
  );
  const modelGuard = await checkModelGuard(ctx, input.messageText, topSimilarity);
  return { results, topResult, topSimilarity, modelGuard };
}

/**
 * 型號守門檢查：判斷訊息是否提到「知識庫查無的型號」，需要引導使用者選型號。
 *
 * 回傳 null = 不攔截（沒提型號 / 型號已知 / KB 相似度夠高可豁免 /
 * 知識庫沒有型號文章（白名單空）/ 型號前綴不在白名單，例如訂單編號）。
 * 回傳物件 = 攔截，附上查無的型號與相近型號清單。
 *
 * 只針對「第一個查無的型號」攔截（通常客戶一次問一台）。
 */
async function checkModelGuard(
  ctx: TenantCtx,
  messageText: string,
  topSimilarity: number,
): Promise<{ unknownModel: string; relatedModels: string[] } | null> {
  const detected = detectModels(messageText);
  if (detected.length === 0) return null;

  // 高相似度豁免：KB 其實找到很像的文章，可能是白名單慢半拍，放行。
  if (topSimilarity >= MODEL_GUARD_EXEMPT_SIMILARITY) return null;

  let knownKeys: ReadonlySet<string>;
  try {
    knownKeys = await getKnownModelKeys(ctx, Date.now());
  } catch (err) {
    // 白名單載入失敗時不要擋人，退回原本流程。
    logger.error('[KbAutoReply] Failed to load model registry, skipping model guard:', err);
    return null;
  }

  for (const model of detected) {
    // 前綴不在白名單就不是這個租戶的型號（例如訂單編號 AB-12345）；
    // 知識庫沒有型號文章（白名單空）時每個前綴都不在白名單，等於不啟用守門（issue #420）
    if (!hasKnownPrefix(model, knownKeys)) continue;
    if (!isKnownModel(model, knownKeys)) {
      const relatedModels = findRelatedModels(model, knownKeys);
      logger.info(
        `[KbAutoReply] model guard hit: "${model.raw}" (key=${model.key}) not in registry, ${relatedModels.length} related`,
      );
      return { unknownModel: model.raw, relatedModels };
    }
  }
  return null;
}

/**
 * 寫入知識庫的機器人回覆並更新對話（design D3）。在 replyGuard 的交易內呼叫。
 *
 * 以條件更新確認對話仍是 BOT_HANDLED：產生回覆期間客服接手時回傳 null，呼叫端 rollback、不送出
 * （bot-handoff-config「轉接後關鍵字規則照常回覆」）。metadata 在這個交易內讀最新的值再合併。
 */
export async function writeKbReply(
  ctx: TenantCtx,
  input: {
    conversationId: string;
    now: Date;
    content: Prisma.InputJsonValue;
    metadata: Prisma.InputJsonValue;
    /** 合併進 conversation.metadata 的欄位（追問次數、型號守門） */
    conversationMetadata: Record<string, unknown>;
  },
) {
  const { tenantId } = ctx;
  const current = await ctx.tx.conversation.findFirst({
    where: { id: input.conversationId, tenantId, status: 'BOT_HANDLED' },
    select: { metadata: true },
  });
  if (!current) return null;
  const existingMeta = (current.metadata ?? {}) as Record<string, unknown>;
  const updated = await ctx.tx.conversation.updateMany({
    where: { id: input.conversationId, tenantId, status: 'BOT_HANDLED' },
    data: {
      botRepliesCount: { increment: 1 },
      lastMessageAt: input.now,
      metadata: { ...existingMeta, ...input.conversationMetadata } as Prisma.InputJsonValue,
    },
  });
  if (updated.count !== 1) return null;

  return ctx.tx.message.create({
    data: {
      conversationId: input.conversationId,
      direction: 'OUTBOUND',
      senderType: 'BOT',
      contentType: 'text',
      content: input.content,
      metadata: input.metadata,
      createdAt: input.now,
    },
  });
}

/**
 * 依 botConfig.handoffPromptEnabled / handoffPromptStyle 決定 KB 回答要不要附
 * handoff 提示（文字 suffix 或 quick reply 按鈕）。
 *
 * - kb_high_confidence：不附（無論 botConfig 設定如何，高信心回答本身已足夠）
 * - kb_with_handoff + enabled=true：依 style 決定（text / button / both / none）
 * - enabled=false：完全不附
 */
export function buildKbReplyPayload(input: {
  replyText: string;
  replyKind: ReplyKind;
  botConfig: BotConfig;
}): { text: string; includeHandoffButton: boolean } {
  const { replyText, replyKind, botConfig } = input;

  if (replyKind !== 'kb_with_handoff') {
    return { text: replyText, includeHandoffButton: false };
  }
  if (!botConfig.handoffPromptEnabled) {
    return { text: replyText, includeHandoffButton: false };
  }

  const style = botConfig.handoffPromptStyle;
  const wantsText = style === 'text' || style === 'both';
  const wantsButton = style === 'button' || style === 'both';
  const text = wantsText
    ? `${replyText}\n\n${DEFAULT_HANDOFF_PROMPT_TEXT}`
    : replyText;
  return { text, includeHandoffButton: wantsButton };
}

/**
 * Fetch the last HISTORY_LIMIT messages of the conversation as
 * user/assistant turns. The just-arrived inbound message is excluded — we
 * pass it separately via `userMessage`.
 */
export async function loadKbHistory(ctx: TenantCtx, conversationId: string): Promise<HistoryMessage[]> {
  const rows = await ctx.tx.message.findMany({
    where: { conversationId, conversation: { tenantId: ctx.tenantId } },
    orderBy: { createdAt: 'desc' },
    // 多取一些：綁定訊息過濾掉之後，仍要留滿 HISTORY_LIMIT 則一般對話
    take: (HISTORY_LIMIT + 1) * AI_HISTORY_FETCH_FACTOR,
    select: { direction: true, senderType: true, content: true, metadata: true },
  });
  // Drop the most recent inbound (the one we're replying to right now).
  const trimmed = rows.length > 0 && rows[0].direction === 'INBOUND' ? rows.slice(1) : rows;

  // 系統發的綁定訊息不給 AI 看、代碼遮掉：AI 曾照抄綁定訊息編出不存在的代碼
  return toAiHistory(trimmed.reverse()).slice(-HISTORY_LIMIT);
}
