/**
 * 各模組的 setupXxx() 以 registerSchedule() 註冊排程，不再自己設計時器（refactor/schedulers-bullmq）。
 * 週期沿用改動前的計時器；analytics 沿用「伺服器時區的 02:00」。
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { Server as SocketIOServer } from 'socket.io';
import type { JobScheduler, ScheduleDefinition } from '#src/lib/job-scheduler.js';
import { setupTrialScheduler } from '#src/modules/trial/trial.scheduler.js';
import { setupAnalyticsScheduler } from '#src/modules/analytics/analytics.scheduler.js';
import { setupCanvasScheduler } from '#src/modules/canvas/canvas.scheduler.js';
import { setupCsatScheduler } from '#src/modules/csat/csat.scheduler.js';
import { setupBroadcastScheduler } from '#src/modules/marketing/broadcast.scheduler.js';
import { setupInactivityCloseWorker } from '#src/modules/conversation/inactivity-close.worker.js';
import { setupMetaTokenHealthScheduler } from '#src/modules/channel/meta-token-health.js';
import { setupOutboxSchedulers } from '#src/modules/outbox/outbox.scheduler.js';

const aggregated: { tenantId: string; date: Date }[] = [];
vi.mock('#src/modules/analytics/analytics.aggregator.js', () => ({
  runDailyAggregation: async (ctx: { tenantId: string }, date: Date) => void aggregated.push({ tenantId: ctx.tenantId, date }),
}));

const prisma = {} as PrismaClient;
const io = {} as SocketIOServer;

function fakeScheduler() {
  const defs: ScheduleDefinition[] = [];
  const scheduler: JobScheduler = {
    registerSchedule: (def) => void defs.push(def),
    start: () => {},
    close: async () => {},
  };
  return { scheduler, defs };
}

function shape(def: ScheduleDefinition) {
  return { id: def.id, every: def.every, pattern: def.pattern, withoutOverlapping: def.withoutOverlapping };
}

beforeEach(() => {
  // 只檢查 setTimeout、setInterval。winston 寫 log 用 setImmediate，不算在內
  vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'Date'] });
});

afterEach(() => {
  // 不應該留下任何計時器：觸發改由 Job Scheduler 負責
  assert.equal(vi.getTimerCount(), 0);
  vi.useRealTimers();
});

test('trial：每小時，以 withoutOverlapping 防重疊，鎖最久 30 分鐘（短於週期）', () => {
  const { scheduler, defs } = fakeScheduler();
  setupTrialScheduler(scheduler, prisma);
  assert.deepEqual(defs.map(shape), [
    { id: 'trial-lifecycle', every: 3_600_000, pattern: undefined, withoutOverlapping: { expiresInMs: 1_800_000 } },
  ]);
});

test('analytics：每天 02:00（cron），不加鎖', () => {
  const { scheduler, defs } = fakeScheduler();
  setupAnalyticsScheduler(scheduler, prisma);
  assert.deepEqual(defs.map(shape), [{ id: 'analytics-daily', every: undefined, pattern: '0 2 * * *', withoutOverlapping: undefined }]);
});

test('canvas：每 60 秒，以 withoutOverlapping 防重疊，鎖最久 10 分鐘', () => {
  const { scheduler, defs } = fakeScheduler();
  setupCanvasScheduler(scheduler);
  assert.deepEqual(defs.map(shape), [
    { id: 'canvas-resume', every: 60_000, pattern: undefined, withoutOverlapping: { expiresInMs: 600_000 } },
  ]);
});

test('csat：發送與自動結案各一個排程，都是每 60 秒', () => {
  const { scheduler, defs } = fakeScheduler();
  setupCsatScheduler(scheduler, prisma, io);
  assert.deepEqual(defs.map(shape), [
    { id: 'csat-send', every: 60_000, pattern: undefined, withoutOverlapping: undefined },
    { id: 'csat-auto-close', every: 60_000, pattern: undefined, withoutOverlapping: undefined },
  ]);
});

test('broadcast：每 60 秒，不加鎖', () => {
  const { scheduler, defs } = fakeScheduler();
  setupBroadcastScheduler(scheduler, prisma, io);
  assert.deepEqual(defs.map(shape), [{ id: 'broadcast-scheduled', every: 60_000, pattern: undefined, withoutOverlapping: undefined }]);
});

test('inactivity-close：每 5 分鐘，不加鎖', () => {
  const { scheduler, defs } = fakeScheduler();
  setupInactivityCloseWorker(scheduler, prisma, io);
  assert.deepEqual(defs.map(shape), [{ id: 'inactivity-close', every: 300_000, pattern: undefined, withoutOverlapping: undefined }]);
});

test('meta-token-health：每 6 小時，不加鎖', () => {
  const { scheduler, defs } = fakeScheduler();
  setupMetaTokenHealthScheduler(scheduler, prisma, io);
  assert.deepEqual(defs.map(shape), [{ id: 'meta-token-health', every: 21_600_000, pattern: undefined, withoutOverlapping: undefined }]);
});

test('analytics 的 run：對每個啟用中的租戶彙總前一天', async () => {
  vi.setSystemTime(new Date(2026, 9, 19, 2, 0, 0));
  const TENANT = 'a0000000-0000-4000-8000-000000000001';
  const { scheduler, defs } = fakeScheduler();
  const where: unknown[] = [];
  const fakePrisma = {
    tenant: {
      findMany: async (args: { where: unknown }) => {
        where.push(args.where);
        return [{ id: TENANT }];
      },
    },
  } as unknown as PrismaClient;
  // 每個租戶的彙總在自己的租戶交易內執行
  const bound: string[] = [];
  const tenantPrisma = {
    $transaction: async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({ $executeRaw: async (_s: TemplateStringsArray, tenantId: string) => void bound.push(tenantId) }),
  } as unknown as PrismaClient;
  setupAnalyticsScheduler(scheduler, { admin: fakePrisma, prisma: tenantPrisma });
  await defs[0].run();
  assert.deepEqual(where, [{ isActive: true }]);
  assert.equal(aggregated.length, 1);
  assert.equal(aggregated[0].tenantId, TENANT);
  assert.equal(aggregated[0].date.getDate(), 18);
  assert.deepEqual(bound, [TENANT]);
});

test('outbox：補送每 60 秒，以 withoutOverlapping 防重疊，鎖最久 5 分鐘；清理每天 03:30（cron）', () => {
  const { scheduler, defs } = fakeScheduler();
  setupOutboxSchedulers(scheduler, prisma);
  assert.deepEqual(defs.map(shape), [
    { id: 'outbox-relay', every: 60_000, pattern: undefined, withoutOverlapping: { expiresInMs: 300_000 } },
    { id: 'outbox-cleanup', every: undefined, pattern: '30 3 * * *', withoutOverlapping: undefined },
  ]);
});
