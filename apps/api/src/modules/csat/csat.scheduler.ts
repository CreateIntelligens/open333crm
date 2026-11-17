import type { ChannelType, PrismaClient } from '@prisma/client';
import type { Server as SocketIOServer } from 'socket.io';
import { csatSurveyChannelTypes } from './csat.service.js';
import { autoCloseCsatCaseFlow, sendCsatSurveyFlow, type CsatFlowDeps } from './csat.flow.js';
import type { EventPublisher } from '../../events/outbox-publisher.js';
import { logger } from '@open333crm/core';
import type { JobScheduler } from '../../lib/job-scheduler.js';

const POLL_INTERVAL_MS = 60_000; // 60 seconds
/** 工單解決後多久寄問卷（issue #339 決定 4：30 分鐘，租戶不能調整） */
export const CSAT_SURVEY_DELAY_MINUTES = 30;
const AUTO_CLOSE_HOURS = 72; // auto-close after 72h without CSAT response

export interface CsatSchedulerDeps {
  /** BYPASSRLS 的連線：跨租戶找出候選工單 */
  admin: PrismaClient;
  /** app_tenant 的基礎連線：每張工單以 inTenant() 處理 */
  prisma: PrismaClient;
  io: SocketIOServer;
  /** 沒給時用 createOutboxPublisher(prisma) */
  events?: EventPublisher;
}

/**
 * 滿意度問卷的兩個排程（change migrate-csat-tenant-ctx，design D1、D2）：
 * 1. 工單解決 30 分鐘後寄問卷
 * 2. 寄出 72 小時沒有回覆時結案
 * 掃描用 admin 連線，每張工單用自己的租戶交易處理；一張失敗只影響這一張，下一期再處理（#337 規劃第 2 節）。
 */
export function setupCsatScheduler(scheduler: JobScheduler, deps: CsatSchedulerDeps) {
  const flowDeps: CsatFlowDeps = { prisma: deps.prisma, io: deps.io, events: deps.events, conversationDb: deps.admin };

  async function pollSendCsat() {
    try {
      const cutoff = new Date(Date.now() - CSAT_SURVEY_DELAY_MINUTES * 60 * 1000);

      const cases = await deps.admin.case.findMany({
        where: {
          status: 'RESOLVED',
          csatSentAt: null,
          // 已評分（客服代評後重新解決）的工單不再寄問卷（issue #339 決定 2）
          csatScore: null,
          resolvedAt: { lte: cutoff },
          // 只查寄得出問卷的渠道（issue #339 決定 7）：其他渠道的工單不進候選，不佔每期的名額
          conversations: { some: { channelType: { in: csatSurveyChannelTypes() as ChannelType[] } } },
          // 租戶停用（含試用到期）時不寄問卷給客人（issue #410）
          tenant: { isActive: true },
        },
        select: { id: true, tenantId: true },
        orderBy: { resolvedAt: 'asc' },
        take: 10,
      });

      for (const c of cases) {
        try {
          const sent = await sendCsatSurveyFlow(flowDeps, { tenantId: c.tenantId, caseId: c.id });
          if (sent) {
            logger.info(`[CsatScheduler] Sent CSAT survey for case ${c.id}`);
          }
        } catch (err) {
          logger.error(`[CsatScheduler] Failed to send CSAT for case ${c.id}:`, err);
        }
      }
    } catch (err) {
      logger.error('[CsatScheduler] Poll send error:', err);
    }
  }

  async function pollAutoClose() {
    try {
      const cutoff = new Date(Date.now() - AUTO_CLOSE_HOURS * 60 * 60 * 1000);

      const cases = await deps.admin.case.findMany({
        where: {
          status: 'RESOLVED',
          csatSentAt: { not: null, lte: cutoff },
          csatRespondedAt: null,
        },
        select: { id: true, tenantId: true },
        orderBy: { csatSentAt: 'asc' },
        take: 10,
      });

      for (const c of cases) {
        try {
          const closed = await autoCloseCsatCaseFlow(flowDeps, { tenantId: c.tenantId, caseId: c.id, autoCloseHours: AUTO_CLOSE_HOURS });
          if (closed) {
            logger.info(`[CsatScheduler] Auto-closed case ${c.id} (no CSAT response after ${AUTO_CLOSE_HOURS}h)`);
          }
        } catch (err) {
          logger.error(`[CsatScheduler] Failed to auto-close case ${c.id}:`, err);
        }
      }
    } catch (err) {
      logger.error('[CsatScheduler] Poll auto-close error:', err);
    }
  }

  scheduler.registerSchedule({ id: 'csat-send', every: POLL_INTERVAL_MS, run: pollSendCsat });
  scheduler.registerSchedule({ id: 'csat-auto-close', every: POLL_INTERVAL_MS, run: pollAutoClose });
}
