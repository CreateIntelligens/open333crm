/**
 * Agent 的執行流程（change migrate-ai-agent-tenant-ctx，design D1）。
 *
 * 資料庫的讀寫各自以 inTenant() 開短交易；LLM、工具與去識別化服務在交易外呼叫。
 * 每一輪的 LLM 呼叫與每一次工具呼叫最多執行一次，工具紀錄在下一次呼叫之前 commit。
 * automation worker、`POST /ai/agent/run` 與 A2A bridge 都呼叫這裡，得到相同的保證。
 */
import type { PrismaClient } from '@open333crm/database';
import type { Server } from 'socket.io';
import { getConfig } from '../../../config/env.js';
import { inTenant, type TenantScope } from '../../../lib/tenant-ctx.js';
import { AppError } from '../../../shared/utils/response.js';
import { notifyChannel } from '../../../events/socket-push.js';
import { getChatProvider } from '../providers/index.js';
import {
  deidentifyTenantData,
  deidentifyTenantText,
  getPrivacyAwareChatProvider,
  prepareStoredMessageContent,
} from '../deidentification.service.js';
import type { AiPrivacyPolicy } from '../../platform/ai-privacy.service.js';
import { prepareLlmCall, recordLlmUsage, type LlmDeps } from '../llm.flow.js';
import { loadOtherChannelContext, withOtherChannelContext } from '../other-channel-context.js';
import type { AccessibleChannels } from '../../../services/channel-visibility.js';
import { containsBindingCode, guardAiReplyForTenant } from '../../identity-binding/ai-guard.js';
import type { BotReplyGuard } from '../../automation/bot-reply-guard.js';
import { deliverToChannel } from '../../conversation/conversation.service.js';
import { addRetentionExpiry } from './retention.js';
import { executeAgentTool, getAgentToolDefinitions } from './tool-registry.js';
import { runAgent, type AgentRunResult, type AgentRunStore } from './runner.js';
import {
  AGENT_SYSTEM_PROMPT,
  assertAgentEligible,
  createAgentRun,
  finishAgentRun,
  loadAgentHistory,
  markAgentRunFailed,
  readAgentRun,
  recordAgentToolCall,
  upsertAgentReportDraft,
} from './agent.service.js';

/**
 * 送到渠道用的連線。`deliverToChannel()` 屬於還沒搬的 conversation，參數仍是舊的連線型別，
 * 這裡直接取它的參數型別，conversation 搬遷時一起換掉（design D3）
 */
type DeliverDb = Parameters<typeof deliverToChannel>[0];

export interface AgentDeps {
  /** app_tenant 的基礎連線，每一步以 inTenant() 開交易 */
  prisma: PrismaClient;
  /** 設定、金鑰、月額度與用量紀錄（change migrate-ai-llm-tenant-ctx） */
  llm: LlmDeps;
  /** 送出回覆時必填 */
  io?: Server;
  /** 送出回覆時必填：以 bot_reply 認領這則入站訊息，每則入站訊息最多一則機器人回覆 */
  replyGuard?: BotReplyGuard;
  /** 送出回覆時必填（design D3） */
  deliverDb?: DeliverDb;
}

export interface AgentReplyInput {
  tenantId: string;
  userMessage: string;
  conversationId?: string;
  messageId?: string;
  initiatedById?: string;
  canPublishWiki?: boolean;
  replyToken?: string;
  receivedAt?: string;
  /** true 時寫入回覆並送到渠道（automation worker） */
  deliver?: boolean;
  /** 客服在後台觸發時傳入客服的可見渠道；讀其他渠道的訊息時依此過濾。客人觸發時不傳（不限制） */
  accessibleChannels?: AccessibleChannels;
}

export type AgentReplyResult = AgentRunResult & { handled: boolean; runId: string };

export async function runAgentReplyFlow(deps: AgentDeps, input: AgentReplyInput): Promise<AgentReplyResult> {
  const config = getConfig();
  const { tenantId } = input;
  const inTx = <T>(fn: (scope: TenantScope) => Promise<T>) => inTenant(deps.prisma, tenantId, fn);

  // 交易 A：先確認對話，月額度也用完時，呼叫端收到的錯誤與搬遷前相同（design D1）
  if (input.conversationId) {
    const conversationId = input.conversationId;
    await inTx((scope) => assertAgentEligible(scope, conversationId));
  }
  // 月額度已滿時丟出 403 PLAN_LIMIT_EXCEEDED
  const prepared = await prepareLlmCall(deps.llm, tenantId);
  const { settings, privacy } = prepared;
  const provider = getChatProvider(settings.provider);
  const protectedProvider = getPrivacyAwareChatProvider(privacy, provider);
  const storedUserMessage = await deidentifyTenantText(privacy, input.userMessage);

  // 交易 B：建立執行紀錄。之後的失敗都把這筆紀錄標成 FAILED
  const run = await inTx((scope) =>
    createAgentRun(scope, {
      conversationId: input.conversationId,
      initiatedById: input.initiatedById,
      provider: provider.id,
      model: settings.model,
      userMessage: storedUserMessage,
      expiresAt: addRetentionExpiry(new Date()),
    }),
  );
  const expiresAt = run.expiresAt;
  const canPublishWiki = input.canPublishWiki ?? config.AGENT_WIKI_AUTO_PUBLISH;

  // 每個回呼先在交易外遮罩，再開一個交易寫入
  const store: AgentRunStore = {
    async recordToolCall(record) {
      const safeTrace = await deidentifyTenantData(privacy, {
        arguments: record.call.arguments,
        result: record.result,
      }) as { arguments: Record<string, unknown>; result: string };
      await inTx((scope) =>
        recordAgentToolCall(scope, {
          runId: run.id,
          turn: record.turn,
          toolName: record.call.name,
          arguments: JSON.parse(JSON.stringify(safeTrace.arguments)),
          result: safeTrace.result,
          status: record.status === 'success' ? 'SUCCESS' : 'FAILED',
          durationMs: record.durationMs,
          expiresAt,
        }),
      );
    },
    async recordUsage(usage) {
      // 寫入失敗只記 log，不中斷 Agent（ai-usage-recording「AiUsage 寫入失敗不影響回覆」）
      await recordLlmUsage(deps.llm, prepared, {
        provider: provider.id,
        model: settings.model,
        usage,
        success: true,
        meta: { feature: 'agent', conversationId: input.conversationId },
      });
    },
    async finishRun(result) {
      const finalText = result.finalText === undefined ? undefined : await deidentifyTenantText(privacy, result.finalText);
      await inTx((scope) =>
        finishAgentRun(scope, run.id, {
          status: result.status === 'completed' ? 'COMPLETED' : 'FAILED',
          stopReason: result.stopReason,
          turnCount: result.turns,
          toolCallCount: result.toolCalls,
          finalText,
        }),
      );
    },
  };

  let result: AgentRunResult;
  try {
    const conversationId = input.conversationId;
    const context = conversationId
      ? await inTx(async (scope) => ({
          history: await loadAgentHistory(scope, conversationId, input.messageId),
          // 歸戶後同一位顧客在其他渠道問過的內容（change add-email-identity-merge）
          otherChannelContext: await loadOtherChannelContext(scope, conversationId, undefined, input.accessibleChannels),
        }))
      : { history: [], otherChannelContext: '' };
    result = await runAgent({
      provider: protectedProvider,
      systemPrompt: withOtherChannelContext(
        settings.chatSystemPrompt ? `${AGENT_SYSTEM_PROMPT}\n\n租戶補充規則：\n${settings.chatSystemPrompt}` : AGENT_SYSTEM_PROMPT,
        context.otherChannelContext,
      ),
      userMessage: input.userMessage,
      history: context.history.map((message) => ({ ...message })),
      tools: getAgentToolDefinitions({ canPublishWiki }),
      executeTool: (name, args) =>
        executeAgentTool(name, args, {
          tenantId,
          runId: run.id,
          canPublishWiki,
          wikiApiToken: config.WIKI_API_TOKEN,
          onWikiPublished: ({ path, shareUrl }) => inTx((scope) => upsertAgentReportDraft(scope, run.id, { path, shareUrl, expiresAt })),
        }),
      store,
      model: settings.model,
      temperature: settings.temperature,
      maxTokens: settings.maxTokens,
      maxTurns: config.AGENT_MAX_TURNS,
      maxToolCalls: config.AGENT_MAX_TOOL_CALLS,
      timeoutMs: config.AGENT_TIMEOUT_MS,
      maxTotalTokens: config.AGENT_MAX_TOTAL_TOKENS,
      baseUrl: settings.baseUrl,
      apiKey: prepared.apiKey,
    });
  } catch (error) {
    const privacyFailure = error instanceof AppError &&
      (error.code === 'AI_DEIDENTIFICATION_UNAVAILABLE' || error.code === 'AI_PRIVACY_POLICY_UNAVAILABLE');
    try {
      await inTx((scope) => markAgentRunFailed(scope, run.id, privacyFailure ? 'privacy_processing_failed' : 'agent_execution_failed'));
    } catch {
      // Preserve the original bounded error and never persist unprocessed trace content.
    }
    throw error;
  }

  // 綁定代碼只能由綁定流程產生：AI 回覆含代碼就整則換成固定說明。不含代碼時不查資料庫（design D6）
  const guarded = result.status === 'completed' && containsBindingCode(result.text)
    ? await inTx((scope) => guardAiReplyForTenant(scope.tx, tenantId, result.text, { conversationId: input.conversationId, source: 'agentic_llm' }))
    : { text: result.text, blocked: false };
  const output: AgentReplyResult = { ...result, text: guarded.text, handled: result.status === 'completed', runId: run.id };
  if (output.handled && input.deliver && input.conversationId && deps.io) {
    if (!deps.replyGuard || !deps.deliverDb) throw new Error('runAgentReplyFlow：deliver 時要傳 replyGuard 與 deliverDb');
    await persistAndDeliverAgentReply(
      { io: deps.io, replyGuard: deps.replyGuard, deliverDb: deps.deliverDb },
      {
        tenantId,
        conversationId: input.conversationId,
        text: output.text,
        runId: output.runId,
        privacy,
        delivery: { replyToken: input.replyToken, receivedAt: input.receivedAt },
        bindingCodeBlocked: guarded.blocked,
      },
    );
  }
  return output;
}

/**
 * 寫入 agent 的回覆並送出（design D3）。遮罩會呼叫去識別化服務，所以在交易之前；
 * 寫入在 replyGuard 的交易內，與 bot_reply 認領一起 commit。推播與送到渠道都在 commit 之後。
 */
export async function persistAndDeliverAgentReply(
  deps: { io: Server; replyGuard: BotReplyGuard; deliverDb: DeliverDb },
  input: {
    tenantId: string;
    conversationId: string;
    text: string;
    runId: string;
    /** prepareLlmCall() 讀到的遮罩政策，不再另外讀一次 */
    privacy: AiPrivacyPolicy;
    delivery: { replyToken?: string; receivedAt?: string };
    bindingCodeBlocked: boolean;
  },
): Promise<void> {
  const { tenantId, conversationId, runId } = input;
  const now = new Date();
  const storedContent = await prepareStoredMessageContent(input.privacy, { text: input.text }, 'system');
  const message = await deps.replyGuard.persist(async (db, scope) => {
    const claimed = await db.conversation.updateMany({
      where: { id: conversationId, tenantId, status: 'BOT_HANDLED' },
      data: { botRepliesCount: { increment: 1 }, lastMessageAt: now },
    });
    if (claimed.count !== 1) return null;

    const created = await db.message.create({
      data: {
        conversationId,
        direction: 'OUTBOUND',
        senderType: 'BOT',
        contentType: 'text',
        content: storedContent.content,
        metadata: { source: 'agentic_llm', agentRunId: runId, ...storedContent.metadata, ...(input.bindingCodeBlocked ? { bindingCodeBlocked: true } : {}) },
        createdAt: now,
      },
      // channelId：推播只送給看得到這個渠道的成員（issue #427）
      select: { id: true, metadata: true, conversation: { select: { channelId: true } } },
    });
    // commit 之後才推播，rollback 時不推播
    notifyChannel(scope, deps.io, { channelId: created.conversation.channelId, conversationId }, 'message.new', {
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
  if (!message) return;
  await deliverToChannel(deps.deliverDb, conversationId, { contentType: 'text', content: storedContent.content, delivery: input.delivery });
}

/** `GET /ai/agent/runs/:id` */
export function readAgentRunFlow(deps: { prisma: PrismaClient }, tenantId: string, runId: string) {
  return inTenant(deps.prisma, tenantId, (scope) => readAgentRun(scope, runId));
}
