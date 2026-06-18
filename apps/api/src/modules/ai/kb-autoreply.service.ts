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
 * The LLM now receives the recent conversation history (last 10 messages) so
 * follow-up turns make sense and clarification questions don't repeat earlier
 * answers.
 */

import type { PrismaClient, Prisma } from '@prisma/client';
import type { Server } from 'socket.io';
import { getConfig } from '../../config/env.js';
import { generateEmbedding, searchSimilarArticles } from '../embedding/embedding.service.js';
import { getEmbeddingSettings } from '../settings/embedding-settings.service.js';
import { getChatSettings } from '../settings/chat-settings.service.js';
import { generateReply, CLARIFY_SYSTEM_PROMPT, MODEL_GUIDE_SYSTEM_PROMPT } from './llm.service.js';
import type { HistoryMessage } from './llm.service.js';
import { detectModels, isKnownModel, findRelatedModels } from './model-matcher.js';
import { getKnownModelKeys } from './model-registry.service.js';
import { deliverToChannel } from '../conversation/conversation.service.js';
import {
  hasMatchingKeywordRule,
  DEFAULT_BOT_CONFIG,
  DEFAULT_HANDOFF_PROMPT_TEXT,
  type BotConfig,
} from '../automation/automation.worker.js';
import { logger } from '@open333crm/core';

const CLARIFY_HANDOFF_FALLBACK =
  '不好意思我這邊還沒辦法判斷您的需求，已為您轉接客服人員，請稍候。';
const HISTORY_LIMIT = 10;

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
function buildKbContext(
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

type ReplyKind =
  | 'kb_high_confidence'
  | 'kb_with_handoff'
  | 'clarify'
  | 'clarify_handoff'
  | 'model_not_found';

export async function attemptKbAutoReply(
  prisma: PrismaClient,
  io: Server,
  tenantId: string,
  conversationId: string,
  messageText: string,
): Promise<boolean> {
  const config = getConfig();

  // 1. Global enable check
  if (!config.KB_AUTO_REPLY_ENABLED) return false;

  // 1.5 若有 keyword.matched 規則命中此訊息，讓步給 keyword 規則處理。
  // 避免 KB 走 clarify_handoff 把對話改成 AGENT_HANDLED，後續 keyword rule 觸發後也無法回。
  if (await hasMatchingKeywordRule(prisma, tenantId, messageText)) {
    logger.info(`[KbAutoReply] conv=${conversationId} skipped: keyword rule will handle`);
    return false;
  }

  // 2. Only proceed for BOT_HANDLED conversations
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, tenantId, status: 'BOT_HANDLED' },
    include: {
      channel: { select: { id: true, channelType: true, credentialsEncrypted: true, settings: true, isActive: true } },
      contact: {
        select: {
          channelIdentities: {
            select: { uid: true, channelId: true },
          },
        },
      },
    },
  });
  if (!conversation) return false;

  // 3. Channel botMode gating + 解析完整 botConfig（含 handoff prompt 設定）
  // spread 對 undefined 才 fallback；空字串 / 不合法 enum 會覆蓋預設，需另外清理。
  const channelSettings = (conversation.channel.settings || {}) as Record<string, unknown>;
  const rawBotConfig = (channelSettings.botConfig || {}) as Partial<BotConfig>;
  const merged: BotConfig = { ...DEFAULT_BOT_CONFIG, ...rawBotConfig };
  const botConfig: BotConfig = {
    ...merged,
    handoffPromptStyle: (['text', 'button', 'both', 'none'] as const).includes(
      merged.handoffPromptStyle,
    )
      ? merged.handoffPromptStyle
      : DEFAULT_BOT_CONFIG.handoffPromptStyle,
    handoffButtonLabel:
      typeof merged.handoffButtonLabel === 'string' && merged.handoffButtonLabel.trim().length > 0
        ? merged.handoffButtonLabel
        : DEFAULT_BOT_CONFIG.handoffButtonLabel,
  };
  if (botConfig.botMode === 'off' || botConfig.botMode === 'keyword') return false;

  // 4. Load tenant chat settings (clarify thresholds + system prompts)
  const chatSettings = await getChatSettings(prisma, tenantId);

  // 5. Fetch conversation history (excluding the just-arrived message we're replying to)
  const history = await loadHistory(prisma, conversationId);

  // 6. Generate embedding for inbound message
  let queryEmbedding: number[];
  try {
    queryEmbedding = await generateEmbedding(prisma, tenantId, messageText);
  } catch (err) {
    logger.error('[KbAutoReply] Failed to generate embedding:', err);
    return false;
  }

  // 7. KB similarity search
  const embeddingSettings = await getEmbeddingSettings(prisma, tenantId);
  const results = await searchSimilarArticles(prisma, queryEmbedding, tenantId, {
    topK: embeddingSettings.topK,
    threshold: embeddingSettings.threshold,
  });
  const topResult = results[0];
  const topSimilarity = topResult?.similarity ?? 0;
  logger.info(
    `[KbAutoReply] conv=${conversationId} kbResults=${results.length} topSim=${topSimilarity.toFixed(3)}`,
  );

  // 7.5 型號守門：客戶提到的型號若不在知識庫白名單，且 KB 相似度不夠高，
  //     代表這可能是「查無此型號（打錯/記錯）」。此時不要拿相近型號的資料硬答，
  //     改為引導客戶從相近型號清單中確認正確型號。
  //     高相似度（>= MODEL_GUARD_EXEMPT_SIMILARITY）豁免，避免誤擋剛新增的型號。
  let replyText: string;
  let replyKind: ReplyKind;
  let metadataExtras: Record<string, unknown> = {};

  const modelGuard = await checkModelGuard(
    prisma,
    tenantId,
    messageText,
    topSimilarity,
  );

  if (modelGuard) {
    // 命中守門 → 引導選型號
    const relatedList = modelGuard.relatedModels;
    const guideContext =
      relatedList.length > 0
        ? `相近型號清單：\n${relatedList.join('\n')}`
        : '';
    try {
      replyText = await generateReply(prisma, tenantId, messageText, guideContext, {
        overrideSystemPrompt: chatSettings.modelGuideSystemPrompt || MODEL_GUIDE_SYSTEM_PROMPT,
        history,
      });
    } catch (err) {
      logger.error('[KbAutoReply] Model-guide generation failed, using fallback:', err);
      replyText =
        relatedList.length > 0
          ? `不好意思，「${modelGuard.unknownModel}」這個型號我這邊查不到資料。` +
            `想再幫您確認一下，您的產品是不是以下其中一款呢？\n${relatedList.join('\n')}\n` +
            `型號通常印在產品本體底部標籤或外箱貼紙上，可以幫您對照看看。`
          : `不好意思，「${modelGuard.unknownModel}」這個型號我這邊查不到資料，` +
            `方便請您確認一下產品本體底部標籤或外箱貼紙上的正確型號嗎？`;
    }
    replyKind = 'model_not_found';
    // 守門不應重置 clarify 計數，但也不該累加；維持原值即可（不寫入 metadataExtras）。
    metadataExtras = {
      modelGuard: {
        unknownModel: modelGuard.unknownModel,
        relatedModels: relatedList,
        topSimilarity,
      },
    };
    return await persistAndDeliver({
      prisma,
      io,
      tenantId,
      conversationId,
      conversation,
      botConfig,
      replyText,
      replyKind,
      topResult,
      results,
      topSimilarity,
      metadataExtras,
    });
  }

  // 8. Decide reply path
  const needsClarify = !topResult || topSimilarity < chatSettings.clarifyThreshold;

  if (needsClarify) {
    // Track clarify attempts in conversation.metadata to avoid loops
    const convMeta = (conversation.metadata ?? {}) as Record<string, unknown>;
    const prevAttempts = Number(convMeta.clarifyAttempts ?? 0);
    const nextAttempts = prevAttempts + 1;

    if (prevAttempts >= chatSettings.clarifyMaxAttempts) {
      replyText = CLARIFY_HANDOFF_FALLBACK;
      replyKind = 'clarify_handoff';
      metadataExtras = { clarifyAttempts: prevAttempts };
    } else {
      try {
        const overridePrompt =
          chatSettings.clarifySystemPrompt || CLARIFY_SYSTEM_PROMPT;
        const llmReply = await generateReply(prisma, tenantId, messageText, '', {
          overrideSystemPrompt: overridePrompt,
          history,
        });
        replyText = llmReply;
        replyKind = 'clarify';
        metadataExtras = { clarifyAttempts: nextAttempts };
      } catch (err) {
        logger.error('[KbAutoReply] Clarify generation failed, handing off:', err);
        replyText = CLARIFY_HANDOFF_FALLBACK;
        replyKind = 'clarify_handoff';
        metadataExtras = { clarifyAttempts: prevAttempts };
      }
    }
  } else {
    // KB has a useful match — use it as grounded context.
    // 採「總預算制」：單篇上限 PER_ARTICLE_LIMIT，全部合計上限 TOTAL_CONTEXT_LIMIT。
    // 避免單篇硬截 1500 字把答案尾段（如客服電話、操作步驟）切掉。
    const kbContext = buildKbContext(results);

    try {
      const llmReply = await generateReply(prisma, tenantId, messageText, kbContext, { history });
      replyText = llmReply;
      replyKind = topSimilarity >= 0.80 ? 'kb_high_confidence' : 'kb_with_handoff';
      // Successful KB answer resets clarify attempts
      metadataExtras = { clarifyAttempts: 0 };
    } catch (err) {
      logger.error('[KbAutoReply] LLM generation failed, falling back to article content:', err);
      replyText = topResult.content || topResult.summary || topResult.title;
      replyKind = topSimilarity >= 0.80 ? 'kb_high_confidence' : 'kb_with_handoff';
      metadataExtras = { clarifyAttempts: 0 };
    }
  }

  return await persistAndDeliver({
    prisma,
    io,
    tenantId,
    conversationId,
    conversation,
    botConfig,
    replyText,
    replyKind,
    topResult,
    results,
    topSimilarity,
    metadataExtras,
  });
}

/**
 * 型號守門檢查：判斷訊息是否提到「知識庫查無的型號」，需要引導使用者選型號。
 *
 * 回傳 null = 不攔截（沒提型號 / 型號已知 / KB 相似度夠高可豁免）。
 * 回傳物件 = 攔截，附上查無的型號與相近型號清單。
 *
 * 只針對「第一個查無的型號」攔截（通常客戶一次問一台）。
 */
async function checkModelGuard(
  prisma: PrismaClient,
  tenantId: string,
  messageText: string,
  topSimilarity: number,
): Promise<{ unknownModel: string; relatedModels: string[] } | null> {
  const detected = detectModels(messageText);
  if (detected.length === 0) return null;

  // 高相似度豁免：KB 其實找到很像的文章，可能是白名單慢半拍，放行。
  if (topSimilarity >= MODEL_GUARD_EXEMPT_SIMILARITY) return null;

  let knownKeys: ReadonlySet<string>;
  try {
    knownKeys = await getKnownModelKeys(prisma, tenantId, Date.now());
  } catch (err) {
    // 白名單載入失敗時不要擋人，退回原本流程。
    logger.error('[KbAutoReply] Failed to load model registry, skipping model guard:', err);
    return null;
  }

  for (const model of detected) {
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
 * 共用的「儲存 BOT 訊息 → 更新對話 → WebSocket 推送 → 送往 channel」流程。
 * KB 正常回答路徑與型號守門路徑共用此函式。
 */
async function persistAndDeliver(input: {
  prisma: PrismaClient;
  io: Server;
  tenantId: string;
  conversationId: string;
  conversation: { metadata: Prisma.JsonValue };
  botConfig: BotConfig;
  replyText: string;
  replyKind: ReplyKind;
  topResult: { id: string; title: string } | undefined;
  results: Array<{ id: string; title: string; similarity: number }>;
  topSimilarity: number;
  metadataExtras: Record<string, unknown>;
}): Promise<boolean> {
  const {
    prisma,
    io,
    tenantId,
    conversationId,
    conversation,
    botConfig,
    replyText,
    replyKind,
    topResult,
    results,
    topSimilarity,
    metadataExtras,
  } = input;

  // 決定要不要附 handoff prompt（只在 kb_with_handoff，kb_high_confidence 不附）
  const kbReply = buildKbReplyPayload({ replyText, replyKind, botConfig });
  // 真正送 channel 的文字（可能多帶 text suffix）— DB 也存這份以利客服 UI 對齊
  const finalText = kbReply.text;

  // Persist BOT message
  const now = new Date();
  const botMessage = await prisma.message.create({
    data: {
      conversationId,
      direction: 'OUTBOUND',
      senderType: 'BOT',
      contentType: 'text',
      content: { text: finalText },
      metadata: {
        source: 'kb_auto_reply',
        replyKind,
        confidence: topSimilarity,
        articleId: topResult?.id,
        articleTitle: topResult?.title,
        allResults: results.map((r) => ({ id: r.id, title: r.title, similarity: r.similarity })),
        ...metadataExtras,
      },
      createdAt: now,
    },
  });

  // Update conversation (counters + clarifyAttempts / modelGuard)
  const existingMeta = (conversation.metadata ?? {}) as Record<string, unknown>;
  await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      botRepliesCount: { increment: 1 },
      lastMessageAt: now,
      metadata: { ...existingMeta, ...metadataExtras } as Prisma.InputJsonValue,
    },
  });

  // Real-time
  const wsPayload = {
    conversationId,
    message: {
      id: botMessage.id,
      conversationId,
      direction: 'OUTBOUND',
      senderType: 'BOT',
      contentType: 'text',
      content: { text: finalText },
      metadata: botMessage.metadata,
      createdAt: now.toISOString(),
      sender: null,
    },
  };
  io.to(`conversation:${conversationId}`).emit('message.new', wsPayload);
  io.to(`tenant:${tenantId}`).emit('message.new', wsPayload);

  // Deliver to actual channel
  // 命中 KB 的回答附「👎 沒幫到我」回報按鈕（quick reply postback），供調教 KB。
  // 加上 handoff_request 按鈕（依 botConfig.handoffPromptStyle）給使用者一鍵轉接。
  // clarify / clarify_handoff / model_not_found 沒命中 KB 文章，不附「沒幫到我」按鈕。
  const hitKb = replyKind === 'kb_high_confidence' || replyKind === 'kb_with_handoff';
  const quickReplies: Array<{ label: string; postbackData: string }> = [];
  if (hitKb && topResult?.id) {
    quickReplies.push({
      label: '👎 沒幫到我',
      postbackData: `kb_feedback:bad:${topResult.id}:${botMessage.id}`,
    });
  }
  if (kbReply.includeHandoffButton) {
    quickReplies.push({
      label: botConfig.handoffButtonLabel,
      postbackData: 'handoff_request',
    });
  }

  if (quickReplies.length > 0) {
    await deliverToChannel(prisma, conversationId, {
      contentType: 'text',
      content: { text: finalText, quickReplies },
    });
  } else {
    await deliverToChannel(prisma, conversationId, finalText);
  }

  logger.info(
    `[KbAutoReply] conv=${conversationId} kind=${replyKind} sim=${topSimilarity.toFixed(3)} handoffStyle=${botConfig.handoffPromptEnabled ? botConfig.handoffPromptStyle : 'disabled'}`,
  );

  return true;
}

/**
 * 依 botConfig.handoffPromptEnabled / handoffPromptStyle 決定 KB 回答要不要附
 * handoff 提示（文字 suffix 或 quick reply 按鈕）。
 *
 * - kb_high_confidence：不附（無論 botConfig 設定如何，高信心回答本身已足夠）
 * - kb_with_handoff + enabled=true：依 style 決定（text / button / both / none）
 * - enabled=false：完全不附
 */
function buildKbReplyPayload(input: {
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
async function loadHistory(
  prisma: PrismaClient,
  conversationId: string,
): Promise<HistoryMessage[]> {
  const rows = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'desc' },
    take: HISTORY_LIMIT + 1,
    select: { direction: true, senderType: true, content: true },
  });
  // Drop the most recent inbound (the one we're replying to right now).
  const trimmed = rows.length > 0 && rows[0].direction === 'INBOUND' ? rows.slice(1) : rows;

  return trimmed
    .reverse()
    .map((m) => {
      const text =
        typeof m.content === 'object' && m.content !== null
          ? ((m.content as { text?: string }).text ?? '')
          : '';
      if (!text) return null;
      const role: 'user' | 'assistant' = m.direction === 'INBOUND' ? 'user' : 'assistant';
      return { role, content: text };
    })
    .filter((m): m is HistoryMessage => m !== null);
}
