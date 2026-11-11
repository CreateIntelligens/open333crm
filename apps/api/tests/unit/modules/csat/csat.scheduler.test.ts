/**
 * 問卷逾時結案：排程讀取候選工單之後，客服可能重開工單、客人可能回覆評分，別次執行也可能
 * 已經結案。排程要先以條件更新認領工單，認領失敗就不改工單、不發事件、不關閉對話。
 * 對應 openspec/changes/claim-csat-schedule-rows/specs/csat-survey/spec.md。
 */
import assert from 'node:assert/strict';
import { afterEach, test, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { Server as SocketIOServer } from 'socket.io';
import type { AppEvent } from '#src/events/event-bus.js';
import type { JobScheduler } from '#src/lib/job-scheduler.js';

const closedConversationsFor = vi.hoisted(() => [] as string[]);

vi.mock('#src/modules/conversation/conversation.service.js', () => ({
  closeConversationsForCase: async (_prisma: unknown, _io: unknown, caseId: string) => {
    closedConversationsFor.push(caseId);
    return 1;
  },
}));
vi.mock('#src/modules/csat/csat.service.js', () => ({ sendCsatSurvey: async () => false }));

const { eventBus } = await import('#src/events/event-bus.js');
const { setupCsatScheduler } = await import('#src/modules/csat/csat.scheduler.js');

const TENANT_ID = 'a0000000-0000-0000-0000-000000000001';
const CASE_ID = 'case-1';

const closedEvents: AppEvent[] = [];
const onCaseClosed = (event: AppEvent) => closedEvents.push(event);
eventBus.subscribe('case.closed', onCaseClosed);

afterEach(() => {
  closedEvents.length = 0;
  closedConversationsFor.length = 0;
});

function createIo() {
  const emitted: string[] = [];
  const io = { to: () => ({ emit: (event: string) => emitted.push(event) }) } as unknown as SocketIOServer;
  return { io, emitted };
}

/**
 * 讀取時工單是 RESOLVED、問卷已逾時、沒有回覆；認領時 updateMany 回傳 claimedCount。
 */
function createDb(claimedCount: number) {
  const updateManyCalls: unknown[] = [];
  const db = {
    case: {
      findMany: async () => [
        {
          id: CASE_ID,
          tenantId: TENANT_ID,
          contactId: 'contact-1',
          channelId: 'channel-1',
          assigneeId: null,
          title: '冷氣不冷',
          priority: 'MEDIUM',
          status: 'RESOLVED',
          csatSentAt: new Date(Date.now() - 73 * 60 * 60 * 1000),
          csatRespondedAt: null,
          conversations: [{ id: 'conv-1' }],
        },
      ],
      updateMany: async (args: unknown) => {
        updateManyCalls.push(args);
        return { count: claimedCount };
      },
      update: async () => ({}),
    },
  };
  return { db: db as unknown as PrismaClient, updateManyCalls };
}

/** 從 registerSchedule() 取得問卷逾時結案的 run */
function getAutoCloseRun(db: PrismaClient, io: SocketIOServer) {
  const runs = new Map<string, () => Promise<void>>();
  const scheduler = {
    registerSchedule: (def: { id: string; run: () => Promise<void> }) => runs.set(def.id, def.run),
  } as unknown as JobScheduler;
  setupCsatScheduler(scheduler, db, io);
  const run = runs.get('csat-auto-close');
  assert.ok(run);
  return run;
}

function assertNothingClosed(emitted: string[]) {
  assert.equal(closedEvents.length, 0);
  assert.equal(emitted.includes('case.updated'), false);
  assert.deepEqual(closedConversationsFor, []);
}

test('排程讀取之後，客服重開了工單', async () => {
  const { db, updateManyCalls } = createDb(0);
  const { io, emitted } = createIo();

  await getAutoCloseRun(db, io)();

  assertNothingClosed(emitted);
  assert.equal(updateManyCalls.length, 1);
  const { where } = updateManyCalls[0] as { where: Record<string, unknown> };
  assert.equal(where.id, CASE_ID);
  assert.equal(where.tenantId, TENANT_ID);
  assert.equal(where.status, 'RESOLVED');
  assert.equal(where.csatRespondedAt, null);
});

test('排程讀取之後，客人回覆了評分', async () => {
  const { db } = createDb(0);
  const { io, emitted } = createIo();

  await getAutoCloseRun(db, io)();

  assertNothingClosed(emitted);
});

test('排程讀取之後，別次執行已經結案', async () => {
  const { db } = createDb(0);
  const { io, emitted } = createIo();

  await getAutoCloseRun(db, io)();

  assertNothingClosed(emitted);
});

test('問卷逾時沒有回覆，工單結案', async () => {
  const { db, updateManyCalls } = createDb(1);
  const { io, emitted } = createIo();

  await getAutoCloseRun(db, io)();

  assert.equal(updateManyCalls.length, 1);
  const { data } = updateManyCalls[0] as { data: Record<string, unknown> };
  assert.equal(data.status, 'CLOSED');
  assert.ok(data.closedAt instanceof Date);
  assert.equal(closedEvents.length, 1);
  assert.equal(emitted.includes('case.updated'), true);
  assert.deepEqual(closedConversationsFor, [CASE_ID]);
});
