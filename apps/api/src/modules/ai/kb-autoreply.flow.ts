/**
 * 知識庫自動回覆的執行流程（change migrate-ai-kb-autoreply-tenant-ctx，design D1）。
 *
 * 資料庫的讀寫各自以 inTenant() 開短交易，受 RLS 約束；embedding、LLM 與去識別化服務在交易外呼叫。
 * 寫入回覆時以條件更新確認對話仍是 BOT_HANDLED，與 bot_reply 認領在同一個交易；commit 之後才推播與送出。
 * 回覆內容的判斷（追問、型號守門、轉接提示）在 kb-autoreply.service.ts。
 *
 * 呼叫端先判斷關鍵字規則的讓步：命中能回覆的關鍵字規則時不呼叫這個函式（design D7）。
 */
import type { PrismaClient } from '@open333crm/database';
import type { Server } from 'socket.io';
import { logger } from '@open333crm/core';
import { inTenant } from '../../lib/tenant-ctx.js';
import { notifyChannel } from '../../events/socket-push.js';
import type { EventPublisher } from '../../events/outbox-publisher.js';
import { embedText } from '../embedding/embedding-client.js';
import { CLARIFY_SYSTEM_PROMPT, MODEL_GUIDE_SYSTEM_PROMPT } from './llm.service.js';
import { generateReply, type LlmDeps } from './llm.flow.js';
import { prepareStoredMessageContent } from './deidentification.service.js';
import { guardAiReplyForTenant } from '../identity-binding/ai-guard.js';
import type { BotReplyGuard } from '../automation/bot-reply-guard.js';
import { handOffConversation } from '../automation/handoff.flow.js';
import { deliverToChannel } from '../conversation/conversation.service.js';
import {
  CLARIFY_HANDOFF_FALLBACK,
  buildKbContext,
  buildKbReplyPayload,
  clarifyExhaustedReason,
  clarifyLlmFailedReason,
  readKbReplyContext,
  searchKbArticles,
  skipped,
  writeKbReply,
  type KbAutoReplyResult,
  type KbReplyContext,
  type KbSearchResult,
  type ReplyKind,
} from './kb-autoreply.service.js';

/**
 * 送到渠道用的連線。`deliverToChannel()` 屬於還沒搬的 conversation，參數仍是舊的連線型別，
 * 這裡直接取它的參數型別，conversation 搬遷時一起換掉（design D5）
 */
type DeliverDb = Parameters<typeof deliverToChannel>[0];

export interface KbAutoReplyDeps {
  /** app_tenant 的基礎連線，每一步以 inTenant() 開交易 */
  prisma: PrismaClient;
  /** 設定、金鑰、月額度與用量紀錄（change migrate-ai-llm-tenant-ctx） */
  llm: LlmDeps;
  io: Server;
  /** 以 bot_reply 認領這則入站訊息：每則入站訊息最多一則機器人回覆 */
  replyGuard: BotReplyGuard;
  /** 轉接真人時在同一個交易發出 conversation.handoff */
  events: EventPublisher;
  deliverDb: DeliverDb;
}

export interface KbAutoReplyInput {
  tenantId: string;
  conversationId: string;
  messageText: string;
  delivery: { replyToken?: string; receivedAt?: string };
}

/** 決定好的回覆（design D1 步驟 4 的結果） */
interface KbReplyDecision {
  replyText: string;
  replyKind: ReplyKind;
  /** 合併進 conversation.metadata，也寫進機器人訊息的 metadata */
  metadataExtras: Record<string, unknown>;
  /** 有值時這則回覆同時轉接真人（clarify_handoff） */
  handoffReason?: string;
}

export async function attemptKbAutoReplyFlow(deps: KbAutoReplyDeps, input: KbAutoReplyInput): Promise<KbAutoReplyResult> {
  const { tenantId, conversationId, messageText } = input;

  // 1. 交易 A：判斷要不要回覆，讀回覆需要的資料。關鍵字讓步由呼叫端先判斷（design D7）
  const context = await inTenant(deps.prisma, tenantId, (scope) => readKbReplyContext(scope, conversationId));
  if ('skip' in context) return skipped(context.skip);

  // 2. 交易外：向量化客人的訊息。沒有向量就無法檢索，也無法回覆：回 failed，由呼叫端轉接真人（issue #445）
  let embedding: number[];
  try {
    embedding = await embedText(context.embeddingSettings, context.policy, messageText);
  } catch (err) {
    logger.error('[KbAutoReply] Failed to generate embedding:', err);
    return { status: 'failed', error: err };
  }

  // 3. 交易 B：搜尋知識庫與型號守門
  const search = await inTenant(deps.prisma, tenantId, (scope) =>
    searchKbArticles(scope, { conversationId, messageText, embedding, settings: context.embeddingSettings }),
  );

  // 4. 交易外：呼叫 LLM 決定回覆
  const decision = await decideReply(deps.llm, input, context, search);

  // 5～8. 檢查綁定代碼、遮罩、寫入、推播與送出
  return persistAndDeliver(deps, input, context, search, decision);
}

/**
 * 依型號守門、相似度與追問次數決定回覆。LLM 失敗時改用文章內容或轉接（bot-handoff-config）。
 * 型號守門回覆與追問共用追問次數：用完時改走追問用完的轉接（issue #420）。
 */
async function decideReply(
  llm: LlmDeps,
  input: KbAutoReplyInput,
  context: KbReplyContext,
  search: KbSearchResult,
): Promise<KbReplyDecision> {
  const { tenantId, conversationId, messageText } = input;
  const { chatSettings, history, otherChannelContext, prevAttempts } = context;
  const { modelGuard, topResult, topSimilarity } = search;
  const nextAttempts = prevAttempts + 1;
  const clarifyExhausted = prevAttempts >= chatSettings.clarifyMaxAttempts;
  const meta = { feature: 'kb-autoreply' as const, conversationId };

  if (modelGuard && !clarifyExhausted) {
    // 客戶提到的型號不在知識庫白名單，且相似度不夠高：引導客戶從相近型號清單中確認正確型號
    const relatedList = modelGuard.relatedModels;
    const guideContext = relatedList.length > 0 ? `相近型號清單：\n${relatedList.join('\n')}` : '';
    let replyText: string;
    try {
      replyText = await generateReply(llm, tenantId, messageText, guideContext, {
        overrideSystemPrompt: chatSettings.modelGuideSystemPrompt || MODEL_GUIDE_SYSTEM_PROMPT,
        history,
        otherChannelContext,
        meta,
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
    // 守門回覆也算一次追問：客人一直提到查無的型號時，追問用完就轉接真人（issue #420）
    return {
      replyText,
      replyKind: 'model_not_found',
      metadataExtras: {
        clarifyAttempts: nextAttempts,
        modelGuard: { unknownModel: modelGuard.unknownModel, relatedModels: relatedList, topSimilarity },
      },
    };
  }

  // 命中型號守門但追問次數已用完：與追問用完相同，回「已為您轉接」並轉接真人
  const needsClarify = !!modelGuard || !topResult || topSimilarity < chatSettings.clarifyThreshold;
  if (needsClarify) {
    if (clarifyExhausted) {
      return {
        replyText: CLARIFY_HANDOFF_FALLBACK,
        replyKind: 'clarify_handoff',
        metadataExtras: { clarifyAttempts: prevAttempts },
        handoffReason: clarifyExhaustedReason(prevAttempts, chatSettings.clarifyMaxAttempts),
      };
    }
    try {
      const replyText = await generateReply(llm, tenantId, messageText, '', {
        overrideSystemPrompt: chatSettings.clarifySystemPrompt || CLARIFY_SYSTEM_PROMPT,
        history,
        otherChannelContext,
        meta,
      });
      return { replyText, replyKind: 'clarify', metadataExtras: { clarifyAttempts: nextAttempts } };
    } catch (err) {
      logger.error('[KbAutoReply] Clarify generation failed, handing off:', err);
      return {
        replyText: CLARIFY_HANDOFF_FALLBACK,
        replyKind: 'clarify_handoff',
        metadataExtras: { clarifyAttempts: prevAttempts },
        handoffReason: clarifyLlmFailedReason(err),
      };
    }
  }

  // 知識庫有可用的文章：以文章為依據回答。成功回答時追問次數歸零
  const replyKind: ReplyKind = topSimilarity >= 0.80 ? 'kb_high_confidence' : 'kb_with_handoff';
  try {
    const replyText = await generateReply(llm, tenantId, messageText, buildKbContext(search.results), {
      history,
      otherChannelContext,
      meta,
    });
    return { replyText, replyKind, metadataExtras: { clarifyAttempts: 0 } };
  } catch (err) {
    logger.error('[KbAutoReply] LLM generation failed, falling back to article content:', err);
    return { replyText: topResult.content || topResult.summary || topResult.title, replyKind, metadataExtras: { clarifyAttempts: 0 } };
  }
}

/**
 * 檢查綁定代碼（交易 C）→ 遮罩（交易外）→ 寫入回覆（replyGuard 的交易）→ commit 之後推播與送出。
 * 帶 handoff 時，同一個交易轉接真人（handOffConversation）；對話已不是 BOT_HANDLED 時整筆 rollback，不送出回覆。
 */
async function persistAndDeliver(
  deps: KbAutoReplyDeps,
  input: KbAutoReplyInput,
  context: KbReplyContext,
  search: KbSearchResult,
  decision: KbReplyDecision,
): Promise<KbAutoReplyResult> {
  const { tenantId, conversationId, delivery } = input;
  const { botConfig, channelId, policy } = context;
  const { topResult, results, topSimilarity } = search;
  const { replyKind, metadataExtras, handoffReason } = decision;

  // 決定要不要附 handoff prompt（只在 kb_with_handoff，kb_high_confidence 不附）
  const kbReply = buildKbReplyPayload({ replyText: decision.replyText, replyKind, botConfig });
  // 綁定代碼只能由綁定流程產生：回覆含代碼（KB 內容或 LLM 生成）就整則換成固定說明。
  // guardAiReplyForTenant() 屬於還沒搬的 identity-binding，以交易 C 的 tx 呼叫（design D5）
  const guarded = await inTenant(deps.prisma, tenantId, (scope) =>
    guardAiReplyForTenant(scope.tx, tenantId, kbReply.text, { conversationId, source: 'kb_autoreply' }),
  );
  // 遮罩沿用交易 A 讀到的政策（design D4）。轉接的系統訊息也在交易外遮罩（與自動轉接相同的文字格式）
  const storedContent = await prepareStoredMessageContent(policy, { text: guarded.text }, 'system');
  const handoffContent = handoffReason
    ? await prepareStoredMessageContent(policy, { text: `自動轉接人工客服：${handoffReason}` }, 'system')
    : null;

  const now = new Date();
  const botMessage = await deps.replyGuard.persist(async (_tx, scope) => {
    const created = await writeKbReply(scope, {
      conversationId,
      now,
      content: storedContent.content,
      metadata: {
        source: 'kb_auto_reply',
        replyKind,
        confidence: topSimilarity,
        articleId: topResult?.id,
        articleTitle: topResult?.title,
        allResults: results.map((r) => ({ id: r.id, title: r.title, similarity: r.similarity })),
        ...metadataExtras,
        ...storedContent.metadata,
        ...(guarded.blocked ? { bindingCodeBlocked: true } : {}),
      },
      // 轉接時追問次數歸零：客服交回 Bot 之後重新計算，不會一交回就再轉接
      conversationMetadata: { ...metadataExtras, ...(handoffReason ? { clarifyAttempts: 0 } : {}) },
    });
    // 產生回覆期間客服接手：不寫入、不送出（design D3）
    if (!created) return null;

    if (handoffReason && handoffContent) {
      const handedOff = await handOffConversation(
        scope,
        { io: deps.io, events: deps.events },
        {
          conversationId,
          channelId,
          reason: handoffReason,
          now,
          systemCreatedAt: new Date(now.getTime() + 1),
          systemContent: handoffContent.content,
          systemMetadata: { type: 'auto_handoff', reason: handoffReason, source: 'kb_auto_reply', ...handoffContent.metadata },
        },
      );
      // 另一個處理已轉接、或客服已接手：不寫入、不送出這則「已為您轉接」
      if (!handedOff) return null;
    }

    // commit 之後才推播，rollback 時不推播
    notifyChannel(scope, deps.io, { channelId, conversationId }, 'message.new', {
      conversationId,
      message: {
        id: created.id,
        conversationId,
        direction: 'OUTBOUND',
        senderType: 'BOT',
        contentType: 'text',
        content: storedContent.content,
        metadata: created.metadata,
        createdAt: now.toISOString(),
        sender: null,
      },
    });
    return created;
  });
  if (!botMessage) {
    logger.info(`[KbAutoReply] conv=${conversationId} skipped: already replied, or no longer BOT_HANDLED`);
    return skipped('already_handled');
  }

  // 送到渠道。命中 KB 的回答附「👎 沒幫到我」回報按鈕（quick reply postback），供調教 KB。
  // 加上 handoff_request 按鈕（依 botConfig.handoffPromptStyle）給使用者一鍵轉接。
  // clarify / clarify_handoff / model_not_found 沒命中 KB 文章，不附「沒幫到我」按鈕。
  const hitKb = replyKind === 'kb_high_confidence' || replyKind === 'kb_with_handoff';
  const quickReplies: Array<{ label: string; postbackData: string }> = [];
  if (hitKb && topResult?.id) {
    quickReplies.push({ label: '👎 沒幫到我', postbackData: `kb_feedback:bad:${topResult.id}:${botMessage.id}` });
  }
  if (kbReply.includeHandoffButton) {
    quickReplies.push({ label: botConfig.handoffButtonLabel, postbackData: 'handoff_request' });
  }
  // deliverToChannel() 屬於還沒搬的 conversation，以 deps.deliverDb 呼叫（design D5）
  await deliverToChannel(deps.deliverDb, conversationId, {
    contentType: 'text',
    content: quickReplies.length > 0 ? { ...storedContent.content, quickReplies } : storedContent.content,
    delivery,
  });

  logger.info(
    `[KbAutoReply] conv=${conversationId} kind=${replyKind} sim=${topSimilarity.toFixed(3)} handoffStyle=${botConfig.handoffPromptEnabled ? botConfig.handoffPromptStyle : 'disabled'}`,
  );
  return { status: 'replied' };
}
