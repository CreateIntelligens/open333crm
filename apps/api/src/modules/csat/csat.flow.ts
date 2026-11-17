/**
 * 滿意度問卷的三條流程（change migrate-csat-tenant-ctx，design D1～D3）：
 * - 寄問卷：交易 A 認領並建立問卷訊息 → 交易外送渠道 → 送不出時交易 B 寫失敗紀錄。
 * - 問卷逾時結案：交易內認領、結案、case.closed 寫進 outbox → commit 之後關閉對話。
 * - 記分：交易 A 寫入分數到 case.closed → 交易外送感謝訊息 → 交易 B 低分通知（失敗時交易 C 留紀錄）→ 關閉對話。
 *
 * 推播一律在 commit 之後送出（notifyChannel、notifyTenant）。讀遮罩政策在開交易之前：
 * readAiPrivacyPolicy() 會接住資料庫錯誤，在交易內呼叫會讓交易失效（#337 規劃 5.2）。
 */
import type { PrismaClient } from '@prisma/client';
import type { Server as SocketIOServer } from 'socket.io';
import { logger } from '@open333crm/core';
import { getChannelPlugin } from '@open333crm/channel-plugins';
import { inTenant } from '../../lib/tenant-ctx.js';
import { notifyChannel, notifyTenant } from '../../events/socket-push.js';
import { createOutboxPublisher, publishEvent, type EventPublisher } from '../../events/outbox-publisher.js';
import { closeConversationsForCase, deliverToChannel } from '../conversation/conversation.service.js';
import { decryptCredentials } from '../channel/channel.service.js';
import { readAiPrivacyPolicy } from '../platform/ai-privacy.service.js';
import { resolveCaseManagerRecipients } from '../notification/notification.service.js';
import { createAndDispatch } from '../notification/notification-effects.js';
import {
  applyCsatScore,
  claimCsatSurvey,
  closeCsatCaseOnTimeout,
  csatSurveyInput,
  recordCsatDeliveryFailure,
  recordCsatLowScoreNotifyFailure,
  type CsatScope,
} from './csat.service.js';

/** `conversation` 還沒搬遷，它的兩個函式在交易外呼叫，要一條綁定租戶或繞過 RLS 的連線（design D4） */
export type ConversationDb = Parameters<typeof deliverToChannel>[0];

export interface CsatFlowDeps {
  /** app_tenant 的基礎連線，每一步以 inTenant() 開交易 */
  prisma: PrismaClient;
  io: SocketIOServer;
  /** 沒給時用 createOutboxPublisher(prisma)；測試注入只寫 outbox 的實作 */
  events?: EventPublisher;
  /** 排程與進站：prismaAdmin；路由：tenantScopedClient()。搬遷 conversation 時拿掉 */
  conversationDb: ConversationDb;
}

const publisherOf = (deps: CsatFlowDeps): EventPublisher => deps.events ?? createOutboxPublisher(deps.prisma);

/** 寄一份問卷（design D1）。認領不到時回傳 false */
export async function sendCsatSurveyFlow(deps: CsatFlowDeps, input: { tenantId: string; caseId: string }): Promise<boolean> {
  const { tenantId, caseId } = input;
  const privacy = await readAiPrivacyPolicy(deps.prisma, tenantId);
  const now = new Date();

  const claimed = await inTenant(deps.prisma, tenantId, async (scope) => {
    const survey = await claimCsatSurvey(scope, caseId, privacy.enabled, now);
    if (survey) {
      notifyChannel(scope, deps.io, { channelId: survey.channelId, conversationId: survey.conversationId }, 'message.new', survey.payload);
    }
    return survey;
  });
  if (!claimed) {
    logger.info(`[CsatService] Skip CSAT survey for case ${caseId}: already sent or no longer RESOLVED`);
    return false;
  }

  // 交易外送渠道。認領之後最多寄一次：失敗不還原 csatSentAt、不自動重寄（issue #416）
  let failureReason = claimed.failureReason;
  if (!failureReason && claimed.target) {
    try {
      const plugin = getChannelPlugin(claimed.channelType);
      if (!plugin?.buildCsatSurvey) throw new Error(`channel ${claimed.channelType} cannot send CSAT surveys`);
      const credentials = decryptCredentials(claimed.target.credentialsEncrypted);
      const result = await plugin.sendMessage(claimed.target.uid, plugin.buildCsatSurvey(csatSurveyInput(caseId)), credentials);
      if (!result.success) failureReason = (result.error || '渠道沒有接受這份問卷').slice(0, 500);
    } catch (err) {
      logger.error('[CsatService] Channel delivery error:', err);
      failureReason = '問卷沒有送到客人，請確認渠道設定';
    }
  }

  if (failureReason) {
    logger.warn(`[CsatService] CSAT survey for case ${caseId} not delivered: ${failureReason}`);
    const reason = failureReason;
    await inTenant(deps.prisma, tenantId, async (scope) => {
      const metadata = await recordCsatDeliveryFailure(scope, {
        caseId, messageId: claimed.messageId, messageMetadata: claimed.messageMetadata, reason,
      });
      // 再推一次 message.new：聊天視窗重新載入，問卷卡片顯示「沒有送出」
      notifyChannel(scope, deps.io, { channelId: claimed.channelId, conversationId: claimed.conversationId }, 'message.new', {
        ...claimed.payload,
        message: { ...claimed.payload.message, metadata },
      });
    }).catch((err: unknown) => logger.error(`[CsatService] Failed to record CSAT delivery failure for case ${caseId}:`, err));
    return true;
  }

  logger.info(`[CsatService] CSAT survey sent for case ${caseId}`);
  return true;
}

/** 問卷逾時沒有回覆，工單結案（design D2）。認領不到時回傳 false */
export async function autoCloseCsatCaseFlow(
  deps: CsatFlowDeps,
  input: { tenantId: string; caseId: string; autoCloseHours: number },
): Promise<boolean> {
  const { tenantId, caseId } = input;
  const now = new Date();
  const closed = await inTenant(deps.prisma, tenantId, async (scope) => {
    const c = await closeCsatCaseOnTimeout(scope, caseId, now);
    if (!c) return null;
    await publishEvent(scope, publisherOf(deps), 'case.closed', {
      caseId: c.id,
      contactId: c.contactId,
      channelId: c.channelId,
      assigneeId: c.assigneeId,
      title: c.title,
      autoClosedNoResponse: true,
    });
    notifyTenant(scope, deps.io, 'case.updated', { id: c.id, status: 'CLOSED', priority: c.priority, assigneeId: c.assigneeId });
    return c;
  });
  if (!closed) {
    logger.info(`[CsatScheduler] Skip auto-close for case ${caseId}: no longer RESOLVED or already rated`);
    return false;
  }

  // 關閉對話屬於還沒搬遷的 conversation，在 commit 之後執行；失敗只記 log（原本的行為）
  try {
    await closeConversationsForCase(deps.conversationDb as PrismaClient, deps.io, caseId, tenantId, {
      source: 'csat',
      reason: `CSAT 未回覆，自動結案 (${input.autoCloseHours}h)`,
    });
  } catch (err) {
    logger.error(`[CsatScheduler] Failed to close conversations after case ${caseId} auto-close:`, err);
  }
  return true;
}

/**
 * 記錄滿意度分數（design D3）。認領不到時回傳 false。
 * 交易 A 的任何寫入失敗時丟出錯誤，不留下分數（csat-survey「記分的寫入一起成功或一起失敗」）。
 */
export async function recordCsatScoreFlow(
  deps: CsatFlowDeps,
  input: { caseId: string; score: number; comment?: string; scope: CsatScope },
): Promise<boolean> {
  const { caseId, score, scope } = input;
  const tenantId = scope.tenantId;
  const privacy = await readAiPrivacyPolicy(deps.prisma, tenantId);
  const now = new Date();

  const applied = await inTenant(deps.prisma, tenantId, async (tx) => {
    const result = await applyCsatScore(tx, { caseId, score, comment: input.comment, scope, privacyEnabled: privacy.enabled, now });
    if (!result) return null;
    const { caseRecord, ratedSurveys, followUp } = result;
    // 先推問卷訊息再推感謝訊息：對話列表的最後一則仍是感謝訊息
    for (const survey of ratedSurveys) {
      notifyChannel(tx, deps.io, { channelId: survey.channelId, conversationId: survey.conversationId }, 'message.new', {
        conversationId: survey.conversationId,
        message: {
          id: survey.id,
          conversationId: survey.conversationId,
          direction: survey.direction,
          senderType: survey.senderType,
          contentType: survey.contentType,
          content: survey.content as Record<string, unknown>,
          metadata: survey.metadata,
          createdAt: survey.createdAt.toISOString(),
          sender: null,
        },
      });
    }
    if (followUp) {
      notifyChannel(tx, deps.io, { channelId: followUp.channelId, conversationId: followUp.conversationId }, 'message.new', followUp.payload);
    }
    await publishEvent(tx, publisherOf(deps), 'case.closed', {
      caseId,
      contactId: caseRecord.contactId,
      channelId: caseRecord.channelId,
      conversationId: followUp?.conversationId,
      assigneeId: caseRecord.assigneeId,
      title: caseRecord.title,
      csatScore: score,
    });
    notifyTenant(tx, deps.io, 'case.updated', { id: caseId, status: 'CLOSED', priority: caseRecord.priority, assigneeId: caseRecord.assigneeId });
    return result;
  });
  if (!applied) {
    logger.info(`[CsatService] Skip CSAT for case ${caseId}: already rated, or no longer RESOLVED`);
    return false;
  }

  // 感謝訊息送到客人的渠道：commit 之後、不等結果（最多一次，原本的行為）
  if (applied.followUp) {
    void deliverToChannel(deps.conversationDb, applied.followUp.conversationId, applied.followUp.text).catch(() => {});
  }

  // 低分只通知、不升級工單（issue #339 決定 5）
  if (score <= 2) {
    await notifyCsatLowScoreFlow(deps, { tenantId, caseId, channelId: applied.caseRecord.channelId, title: applied.caseRecord.title, score });
  }

  // 評分後關閉對話，與問卷逾時結案相同（issue #339 決定 6）
  try {
    await closeConversationsForCase(deps.conversationDb as PrismaClient, deps.io, caseId, tenantId, {
      source: 'csat',
      reason: applied.ratedBy === 'agent' ? '客服代評滿意度後自動結案' : '客人評分後自動結案',
    });
  } catch (err) {
    logger.error(`[CsatService] Failed to close conversations after CSAT for case ${caseId}:`, err);
  }

  logger.info(`[CsatService] CSAT recorded for case ${caseId}: score=${score}`);
  return true;
}

/**
 * CSAT 低分通知（csat-survey「低分只通知負責工單的成員」）：交易 B 查收件人並寫入通知，commit 之後推播。
 * 失敗時交易 B rollback，再以交易 C 在時間軸寫 csat_low_score_notify_failed；分數不受影響。
 */
export async function notifyCsatLowScoreFlow(
  deps: Pick<CsatFlowDeps, 'prisma' | 'io'>,
  input: { tenantId: string; caseId: string; channelId: string; title: string; score: number },
): Promise<void> {
  try {
    await inTenant(deps.prisma, input.tenantId, async (scope) => {
      const recipients = await resolveCaseManagerRecipients(scope, input.channelId);
      for (const agentId of recipients) {
        await createAndDispatch(scope, deps.io, {
          agentId,
          type: 'csat_low_score',
          title: 'CSAT 低分警報',
          body: `案件「${input.title}」收到 ${input.score} 分評價，請關注處理。`,
          clickUrl: `/dashboard/cases?id=${input.caseId}`,
        });
      }
    });
  } catch (err) {
    logger.error(`[CsatService] Failed to notify CSAT low score for case ${input.caseId}:`, err);
    await inTenant(deps.prisma, input.tenantId, (scope) => recordCsatLowScoreNotifyFailure(scope, { caseId: input.caseId, score: input.score }))
      .catch((recordErr: unknown) =>
        logger.error(`[CsatService] Failed to record low score notify failure for case ${input.caseId}:`, recordErr));
  }
}
