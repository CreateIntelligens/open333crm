/**
 * 粉絲門戶活動與積分的 flow（#337 階段 3，AGENTS.md 結構規則 2）。
 *
 * 粉絲送出活動時，作答、積分與 portal.activity.submitted 事件在同一個交易寫入：
 * 其中一項寫不進去時一起 rollback。事件寫進 outbox，commit 之後才送給訂閱者，至少送出一次。
 * 粉絲門戶的入口以 fanToken 的租戶開交易。
 */
import type { PrismaClient } from '@prisma/client';
import { createOutboxPublisher, publishEvent, type EventPublisher } from '../../events/outbox-publisher.js';
import { flowOf, inTenant } from '../../lib/tenant-ctx.js';
import {
  archiveActivity,
  createActivity,
  deleteActivity,
  drawWinners,
  endActivity,
  getActivity,
  getActivityForFan,
  getActivityResult,
  listActivities,
  listContactSubmissions,
  listOpenActivitiesForFan,
  listSubmissions,
  publishActivity,
  submitActivity,
  unarchiveActivity,
  updateActivity,
} from './portal.service.js';
import { addPointTransaction, getPointBalance, listPointTransactions } from './points.service.js';

// ─── 後台：活動 ─────────────────────────────────────────────────────────────

export const listActivitiesFlow = flowOf(listActivities);
export const getActivityFlow = flowOf(getActivity);
export const createActivityFlow = flowOf(createActivity);
export const updateActivityFlow = flowOf(updateActivity);
export const deleteActivityFlow = flowOf(deleteActivity);
export const publishActivityFlow = flowOf(publishActivity);
export const endActivityFlow = flowOf(endActivity);
export const archiveActivityFlow = flowOf(archiveActivity);
export const unarchiveActivityFlow = flowOf(unarchiveActivity);
export const listSubmissionsFlow = flowOf(listSubmissions);
export const drawWinnersFlow = flowOf(drawWinners);

// ─── 後台：積分 ─────────────────────────────────────────────────────────────

export const listPointTransactionsFlow = flowOf(listPointTransactions);
export const addPointTransactionFlow = flowOf(addPointTransaction);
export const getPointBalanceFlow = flowOf(getPointBalance);

// ─── 粉絲門戶 ──────────────────────────────────────────────────────────────

/** 粉絲門戶的請求者：fanToken 驗簽後的聯絡人與租戶 */
export interface FanActor {
  tenantId: string;
  contactId: string;
}

export const listOpenActivitiesForFanFlow = flowOf(listOpenActivitiesForFan);
export const getActivityForFanFlow = flowOf(getActivityForFan);
export const getActivityResultFlow = flowOf(getActivityResult);
export const listContactSubmissionsFlow = flowOf(listContactSubmissions);

/** 粉絲的積分餘額與最近 50 筆交易，在同一個交易內讀取 */
export function getFanPointsFlow(deps: { prisma: PrismaClient }, fan: FanActor) {
  return inTenant(deps.prisma, fan.tenantId, async (scope) => ({
    balance: await getPointBalance(scope, fan.contactId),
    transactions: await listPointTransactions(scope, fan.contactId, 1, 50),
  }));
}

/** 送出活動的入口：events 預設寫 outbox（測試可替換） */
export interface SubmitActivityDeps {
  prisma: PrismaClient;
  events?: EventPublisher;
}

export function submitActivityFlow(
  deps: SubmitActivityDeps,
  fan: FanActor,
  activityId: string,
  answers: { optionIds?: string[]; fields?: Record<string, string> },
) {
  const events = deps.events ?? createOutboxPublisher(deps.prisma);
  return inTenant(deps.prisma, fan.tenantId, async (scope) => {
    const { submission, activityType } = await submitActivity(scope, activityId, fan.contactId, answers);
    await publishEvent(scope, events, 'portal.activity.submitted', {
      activityId,
      contactId: fan.contactId,
      submissionId: submission.id,
      activityType,
    });
    return submission;
  });
}
