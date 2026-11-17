import type { ChannelType, Prisma } from '@prisma/client';
import type { TenantCtx } from '../../lib/tenant-ctx.js';
import { getAllChannelPlugins, getChannelPlugin, type CsatSurveyInput } from '@open333crm/channel-plugins';
import { caseTransitionTimestamps, type CaseStatus } from '@open333crm/shared';
import { fixedSystemMessageContent } from '../ai/deidentification.service.js';

/**
 * 客人按下問卷分數後看到的文字：LINE 按鈕的 displayText，以及收件匣顯示的客人訊息（issue #444）。
 */
export function csatReplyDisplayText(score: number): string {
  return `我的評分：${score} 分`;
}

/** 問卷的問題：LINE Flex 的內文與替代文字 */
export const CSAT_SURVEY_QUESTION = '感謝您的耐心等候！請評價此次服務體驗（1-5 分）';

/**
 * 問卷的內容：問題與五個分數選項。按鈕送回 csat:<分數>:<工單 ID>（進站攔截的格式），
 * 客人看到的是 csatReplyDisplayText()。渠道的版型由外掛的 buildCsatSurvey() 決定（issue #339 決定 7）。
 */
export function csatSurveyInput(caseId: string): CsatSurveyInput {
  return {
    question: CSAT_SURVEY_QUESTION,
    options: [1, 2, 3, 4, 5].map((score) => ({
      label: `${score}`,
      postbackData: `csat:${score}:${caseId}`,
      displayText: csatReplyDisplayText(score),
    })),
  };
}

/**
 * 寄得出問卷的渠道類型：外掛實作 buildCsatSurvey() 的渠道（目前只有 LINE）。
 * 依外掛能力判斷，不在這裡比對 channelType（AGENTS.md 結構規則 5，issue #339 決定 7）。
 */
export function csatSurveyChannelTypes(): string[] {
  return getAllChannelPlugins()
    .filter((plugin) => typeof plugin.buildCsatSurvey === 'function')
    .map((plugin) => plugin.channelType);
}

/** 問卷訊息推送給收件匣的內容（message.new） */
export interface CsatMessagePayload {
  conversationId: string;
  message: {
    id: string;
    conversationId: string;
    direction: string;
    senderType: string;
    contentType: string;
    content: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    createdAt: string;
    sender: null;
  };
}

function messagePayload(message: {
  id: string; conversationId: string; direction: string; senderType: string; contentType: string; content: unknown; createdAt: Date;
}, metadata?: Record<string, unknown>): CsatMessagePayload {
  return {
    conversationId: message.conversationId,
    message: {
      id: message.id,
      conversationId: message.conversationId,
      direction: message.direction,
      senderType: message.senderType,
      contentType: message.contentType,
      content: message.content as Record<string, unknown>,
      ...(metadata ? { metadata } : {}),
      createdAt: message.createdAt.toISOString(),
      sender: null,
    },
  };
}

/** 認領之後要送出的問卷：送到哪裡，或已知送不出的原因 */
export interface ClaimedCsatSurvey {
  caseId: string;
  channelId: string;
  conversationId: string;
  channelType: string;
  messageId: string;
  messageMetadata: unknown;
  payload: CsatMessagePayload;
  /** 送得出時的收件人與渠道憑證（加密）；送不出時是 null，原因在 failureReason */
  target: { uid: string; credentialsEncrypted: string } | null;
  failureReason: string | null;
}

/**
 * 認領工單並在對話中建立問卷訊息（csat-survey「每次解決最多寄出一份滿意度問卷」）。
 * 認領與問卷訊息在呼叫端的同一個交易內寫入：問卷訊息寫入失敗時，認領一起 rollback，之後的執行可以再寄。
 * 同時讀出渠道與客人在該渠道的帳號，讓 flow 在交易外送出。認領不到時回傳 null。
 */
export async function claimCsatSurvey(
  ctx: TenantCtx,
  caseId: string,
  privacyEnabled: boolean,
  now: Date,
): Promise<ClaimedCsatSurvey | null> {
  // 只取寄得出問卷的渠道的對話（issue #339 決定 7）：沒有就不認領，工單停在已解決、不逾時結案
  const caseRecord = await ctx.tx.case.findFirst({
    where: { id: caseId, tenantId: ctx.tenantId },
    include: {
      conversations: {
        where: { channelType: { in: csatSurveyChannelTypes() as ChannelType[] } },
        include: { channel: true },
        take: 1,
      },
    },
  });

  if (!caseRecord) return null;
  if (caseRecord.status !== 'RESOLVED') return null;
  if (caseRecord.csatSentAt) return null;
  const conversation = caseRecord.conversations[0];
  const plugin = conversation ? getChannelPlugin(conversation.channelType) : undefined;
  if (!conversation || !plugin?.buildCsatSurvey) return null;

  // 以條件更新認領：job 重跑、兩期重疊，或讀取後工單被重開時，只有認領成功的一次會寄。
  // 租戶在排程查詢之後才被停用時也認領不到（issue #410）。已評分的工單不寄（issue #339 決定 2）
  const { count } = await ctx.tx.case.updateMany({
    where: { id: caseId, tenantId: ctx.tenantId, status: 'RESOLVED', csatSentAt: null, csatScore: null, tenant: { isActive: true } },
    data: { csatSentAt: now },
  });
  if (count === 0) return null;

  // 固定文字不呼叫去識別化服務（issue #466）；caseId 是協定欄位
  const stored = fixedSystemMessageContent({ text: '滿意度調查', caseId }, privacyEnabled);
  const message = await ctx.tx.message.create({
    data: {
      conversationId: conversation.id,
      direction: 'OUTBOUND',
      senderType: 'SYSTEM',
      contentType: 'csat',
      content: stored.content,
      metadata: { type: 'csat_survey', caseId, ...stored.metadata },
      isRead: true,
      createdAt: now,
    },
  });
  await ctx.tx.conversation.updateMany({
    where: { id: conversation.id, tenantId: ctx.tenantId },
    data: { lastMessageAt: now },
  });

  const channel = conversation.channel;
  const identity = channel?.isActive
    ? await ctx.tx.channelIdentity.findFirst({ where: { contactId: caseRecord.contactId, channelId: channel.id } })
    : null;
  let failureReason: string | null = null;
  if (!channel?.isActive) failureReason = '渠道已停用或不存在，問卷沒有送到客人';
  else if (!identity) failureReason = '找不到這位聯絡人在此渠道的帳號，問卷沒有送到客人';

  return {
    caseId,
    channelId: conversation.channelId,
    conversationId: conversation.id,
    channelType: conversation.channelType,
    messageId: message.id,
    messageMetadata: message.metadata,
    payload: messagePayload(message),
    target: failureReason || !identity || !channel ? null : { uid: identity.uid, credentialsEncrypted: channel.credentialsEncrypted },
    failureReason,
  };
}

/**
 * 滿意度問卷沒有送到客人時，留下客服看得到的紀錄（issue #416）：
 * - 問卷訊息的 metadata 標 `deliveryFailed` 與原因：收件匣的問卷卡片與對話列表顯示「沒有送出」。
 * - 工單時間軸寫一筆 `csat_send_failed`。
 * 回傳更新後的 metadata，讓呼叫端推播給聊天視窗。
 */
export async function recordCsatDeliveryFailure(
  ctx: TenantCtx,
  input: { caseId: string; messageId: string; messageMetadata: unknown; reason: string },
): Promise<Record<string, unknown>> {
  const base = input.messageMetadata && typeof input.messageMetadata === 'object' && !Array.isArray(input.messageMetadata)
    ? (input.messageMetadata as Record<string, unknown>)
    : {};
  const metadata = { ...base, deliveryFailed: true, deliveryError: input.reason };
  // 只動這個租戶的資料：舊入口傳進來的 tx 不一定綁定租戶（PR #440 審查）
  await ctx.tx.message.updateMany({
    where: { id: input.messageId, conversation: { tenantId: ctx.tenantId } },
    data: { metadata: metadata as Prisma.InputJsonValue },
  });
  const caseInTenant = await ctx.tx.case.count({ where: { id: input.caseId, tenantId: ctx.tenantId } });
  if (caseInTenant === 0) return metadata;
  await ctx.tx.caseEvent.create({
    data: {
      caseId: input.caseId,
      actorType: 'system',
      eventType: 'csat_send_failed',
      payload: { reason: input.reason, messageId: input.messageId },
    },
  });
  return metadata;
}

/**
 * 評分後回覆客人的文字，依分數決定。
 */
export function csatFollowUpText(score: number): string {
  if (score <= 2) {
    return '非常抱歉讓您感到不滿意，我們會立即安排主管為您跟進處理，請您稍候。';
  }
  if (score === 3) {
    return '感謝您的回饋！我們會持續改善服務品質，期待下次能為您提供更好的體驗。';
  }
  return '非常感謝您的好評！您的肯定是我們最大的動力，期待再次為您服務！';
}

/**
 * 誰可以替這張工單評分：
 * - tenantId：工單必須屬於這個租戶。
 * - contactId：給了就必須是工單的聯絡人（進站評分）；客服操作不給。
 */
export interface CsatScope {
  tenantId: string;
  contactId?: string;
  /** 客服代評時評分的客服；時間軸記錄評分者（issue #444）。客人回覆不給 */
  agentId?: string;
}

/** 誰評的分：客人回覆問卷，或客服在後台代評 */
export type CsatRatedBy = 'customer' | 'agent';

/** 已寫入分數的問卷訊息：呼叫端推一次 message.new，讓收件匣的問卷卡片顯示分數 */
export interface RatedSurveyMessage {
  id: string;
  conversationId: string;
  channelId: string;
  direction: string;
  senderType: string;
  contentType: string;
  content: unknown;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

function asMetadataObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/**
 * 記錄分數之後讓客服看得到結果（issue #444）：
 * - 這張工單的問卷訊息 metadata 寫入 csatScore 與 csatRatedBy：收件匣的問卷卡片只讀這兩個欄位。
 * - 工單時間軸寫一筆 csat_rated，標明客人評分或客服代評。
 * 回傳更新後的問卷訊息，讓呼叫端推播給聊天視窗。
 */
export async function recordCsatRating(
  ctx: TenantCtx,
  input: { caseId: string; score: number; ratedBy: CsatRatedBy; agentId?: string },
): Promise<RatedSurveyMessage[]> {
  // 先以工單的對話縮小範圍（走 conversations.caseId 與 messages.conversationId 索引），再比對 metadata.caseId
  const surveys = await ctx.tx.message.findMany({
    where: {
      contentType: 'csat',
      metadata: { path: ['caseId'], equals: input.caseId },
      conversation: { tenantId: ctx.tenantId, caseId: input.caseId },
    },
    include: { conversation: { select: { channelId: true } } },
  });

  const rated: RatedSurveyMessage[] = [];
  for (const survey of surveys) {
    const metadata = { ...asMetadataObject(survey.metadata), csatScore: input.score, csatRatedBy: input.ratedBy };
    await ctx.tx.message.updateMany({
      where: { id: survey.id, conversation: { tenantId: ctx.tenantId } },
      data: { metadata: metadata as Prisma.InputJsonValue },
    });
    rated.push({
      id: survey.id,
      conversationId: survey.conversationId,
      channelId: survey.conversation.channelId,
      direction: survey.direction,
      senderType: survey.senderType,
      contentType: survey.contentType,
      content: survey.content,
      metadata,
      createdAt: survey.createdAt,
    });
  }

  await ctx.tx.caseEvent.create({
    data: {
      caseId: input.caseId,
      actorType: input.ratedBy === 'agent' ? 'agent' : 'contact',
      actorId: input.ratedBy === 'agent' ? (input.agentId ?? null) : null,
      eventType: 'csat_rated',
      payload: { score: input.score, source: input.ratedBy },
    },
  });
  return rated;
}

/**
 * 評分後系統自動關閉工單：時間軸寫一筆 status_changed（issue #444）。工單原本就是 CLOSED 時不寫。
 */
export async function recordCsatAutoClose(ctx: TenantCtx, input: { caseId: string; from: string }): Promise<void> {
  if (input.from === 'CLOSED') return;
  await ctx.tx.caseEvent.create({
    data: {
      caseId: input.caseId,
      actorType: 'system',
      eventType: 'status_changed',
      payload: { from: input.from, to: 'CLOSED', reason: 'csat_rated' },
    },
  });
}

/**
 * 進站的評分（csat:<分數>:<工單 ID>）被攔截後，把這則客人訊息改寫成客人在 LINE 上看到的文字，
 * 原始資料存在 metadata.postbackData（issue #444）。LINE webhook 不送按鈕的 displayText，
 * 不改寫的話收件匣、匯出與 AI 讀到的歷史都是代碼。
 * 改寫的文字是程式固定的內容：原本有遮罩副本（租戶啟用去識別化）時，副本改成同一段文字，不呼叫 2md。
 */
export async function relabelCsatReplyMessage(
  ctx: TenantCtx,
  input: { messageId: string; messageMetadata: unknown; score: number; postbackData: string },
): Promise<void> {
  const base = asMetadataObject(input.messageMetadata);
  const fixed = fixedSystemMessageContent({ text: csatReplyDisplayText(input.score) }, base.privacy !== undefined);
  const metadata = { ...base, ...fixed.metadata, postbackData: input.postbackData };
  await ctx.tx.message.updateMany({
    where: { id: input.messageId, conversation: { tenantId: ctx.tenantId } },
    data: { content: fixed.content as Prisma.InputJsonValue, metadata: metadata as Prisma.InputJsonValue },
  });
}

/** 記分寫入之後，flow 推送與後續動作需要的資料 */
export interface AppliedCsatScore {
  caseRecord: {
    id: string; tenantId: string; contactId: string; channelId: string; title: string;
    priority: string; assigneeId: string | null; status: string;
  };
  ratedBy: CsatRatedBy;
  ratedSurveys: RatedSurveyMessage[];
  /** 感謝訊息：工單沒有對話時是 null */
  followUp: { text: string; conversationId: string; channelId: string; payload: CsatMessagePayload } | null;
}

/**
 * 記錄滿意度分數（csat-survey「記分的寫入一起成功或一起失敗」）：在呼叫端的同一個交易內寫入
 * 分數、問卷卡片的分數、時間軸的評分事件、感謝訊息、工單結案與結案事件。任何一筆失敗時整個交易 rollback。
 * 認領不到（已評分、客人評分時工單不是已解決、工單不屬於這個租戶或聯絡人）時回傳 null，不寫入任何東西。
 */
export async function applyCsatScore(
  ctx: TenantCtx,
  input: { caseId: string; score: number; comment?: string; scope: CsatScope; privacyEnabled: boolean; now: Date },
): Promise<AppliedCsatScore | null> {
  const { caseId, score, scope, now } = input;
  if (score < 1 || score > 5) return null;
  // 進站的評分只能替自己的工單評分：給了 contactId 就必須是工單的聯絡人（AUDIT RLS-06）
  const caseRecord = await ctx.tx.case.findFirst({
    where: { id: caseId, tenantId: ctx.tenantId, contactId: scope.contactId },
    include: { conversations: { select: { id: true, channelId: true }, take: 1 } },
  });
  if (!caseRecord) return null;
  if (caseRecord.csatScore !== null) return null;

  const ratedBy: CsatRatedBy = scope.agentId ? 'agent' : 'customer';
  // 客人只能替已解決的工單評分（issue #520）。客服代評不限狀態
  const statusClaim = ratedBy === 'customer' ? { status: 'RESOLVED' as const } : {};
  if (ratedBy === 'customer' && caseRecord.status !== 'RESOLVED') return null;

  // 以條件更新認領（issue #339）：兩個請求同時通過上面的檢查時，只有一次寫得進去
  const { count } = await ctx.tx.case.updateMany({
    where: { id: caseId, tenantId: ctx.tenantId, contactId: scope.contactId, csatScore: null, ...statusClaim },
    data: { csatScore: score, csatComment: input.comment ?? null, csatRespondedAt: now, csatRatedBy: ratedBy },
  });
  if (count === 0) return null;

  const ratedSurveys = await recordCsatRating(ctx, { caseId, score, ratedBy, agentId: scope.agentId });

  let followUp: AppliedCsatScore['followUp'] = null;
  const conversation = caseRecord.conversations[0];
  if (conversation) {
    const text = csatFollowUpText(score);
    // 評分後的回覆是程式固定的三種文字之一，不呼叫去識別化服務（issue #466）
    const stored = fixedSystemMessageContent({ text }, input.privacyEnabled);
    const message = await ctx.tx.message.create({
      data: {
        conversationId: conversation.id,
        direction: 'OUTBOUND',
        senderType: 'SYSTEM',
        contentType: 'text',
        content: stored.content,
        metadata: { type: 'csat_followup', csatScore: score, ...stored.metadata },
        isRead: true,
        createdAt: now,
      },
    });
    await ctx.tx.conversation.updateMany({
      where: { id: conversation.id, tenantId: ctx.tenantId },
      data: { lastMessageAt: now },
    });
    followUp = { text, conversationId: conversation.id, channelId: conversation.channelId, payload: messagePayload(message) };
  }

  // 評分後工單結案。resolvedAt 依共用規則（issue #417）：從 RESOLVED 結案保留，沒有經過 RESOLVED 的不算已解決
  await ctx.tx.case.updateMany({
    where: { id: caseId, tenantId: ctx.tenantId },
    data: {
      status: 'CLOSED',
      closedAt: now,
      ...caseTransitionTimestamps(caseRecord.status as CaseStatus, 'CLOSED', now),
    },
  });
  await recordCsatAutoClose(ctx, { caseId, from: caseRecord.status });

  return {
    caseRecord: {
      id: caseRecord.id, tenantId: caseRecord.tenantId, contactId: caseRecord.contactId, channelId: caseRecord.channelId,
      title: caseRecord.title, priority: caseRecord.priority, assigneeId: caseRecord.assigneeId, status: caseRecord.status,
    },
    ratedBy,
    ratedSurveys,
    followUp,
  };
}

/**
 * 問卷逾時結案（csat-survey「問卷逾時結案不覆蓋已變更的工單」）：以條件更新認領並結案。
 * 讀取之後工單被重開、客人已評分，或別次執行已結案時，回傳 null。
 */
export async function closeCsatCaseOnTimeout(ctx: TenantCtx, caseId: string, now: Date) {
  const { count } = await ctx.tx.case.updateMany({
    where: { id: caseId, tenantId: ctx.tenantId, status: 'RESOLVED', csatRespondedAt: null },
    // RESOLVED → CLOSED：依共用規則（issue #417）寫 closedAt、保留 resolvedAt
    data: { status: 'CLOSED', ...caseTransitionTimestamps('RESOLVED', 'CLOSED', now) },
  });
  if (count === 0) return null;
  return ctx.tx.case.findFirstOrThrow({
    where: { id: caseId, tenantId: ctx.tenantId },
    select: { id: true, contactId: true, channelId: true, assigneeId: true, title: true, priority: true },
  });
}

/**
 * 低分通知送不出時，在工單時間軸留下紀錄（csat-survey「低分通知送不出時客服看得到」）。
 * 呼叫端在通知的交易 rollback 之後，以另一個交易寫入。
 */
export async function recordCsatLowScoreNotifyFailure(ctx: TenantCtx, input: { caseId: string; score: number }): Promise<void> {
  const caseInTenant = await ctx.tx.case.count({ where: { id: input.caseId, tenantId: ctx.tenantId } });
  if (caseInTenant === 0) return;
  await ctx.tx.caseEvent.create({
    data: {
      caseId: input.caseId,
      actorType: 'system',
      eventType: 'csat_low_score_notify_failed',
      payload: { score: input.score, reason: '低分通知沒有送出，請手動通知負責的成員' },
    },
  });
}
