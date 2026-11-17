/**
 * 問卷逾時結案：排程讀取候選工單之後，客服可能重開工單、客人可能回覆評分，別次執行也可能
 * 已經結案。排程要先以條件更新認領工單，認領失敗就不改工單、不發事件、不關閉對話。
 * case.closed 經 outbox 發布（change migrate-csat-tenant-ctx design D2），這裡以替身記錄寫進 outbox 的事件。
 * 對應 openspec/changes/claim-csat-schedule-rows/specs/csat-survey/spec.md。
 */
import assert from 'node:assert/strict';
import { afterEach, test, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { Server as SocketIOServer } from 'socket.io';
import type { JobScheduler } from '#src/lib/job-scheduler.js';
import { createFlowLog, type FlowLog } from '../../../support/flow-harness.js';
import { csatFlowDeps } from '../../../support/csat-flow.js';

const closedConversationsFor = vi.hoisted(() => [] as string[]);

vi.mock('#src/modules/conversation/conversation.service.js', () => ({
  closeConversationsForCase: async (_prisma: unknown, _io: unknown, caseId: string) => {
    closedConversationsFor.push(caseId);
    return 1;
  },
}));
const { setupCsatScheduler } = await import('#src/modules/csat/csat.scheduler.js');

const TENANT_ID = 'a0000000-0000-0000-0000-000000000001';
const CASE_ID = 'case-1';

let log: FlowLog = createFlowLog();
const closedEvents = () => log.events.filter((e) => e.name === 'case.closed');

afterEach(() => {
  log = createFlowLog();
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
      findFirstOrThrow: async () => ({
        id: CASE_ID, contactId: 'contact-1', channelId: 'channel-1', assigneeId: null, title: '冷氣不冷', priority: 'MEDIUM',
      }),
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
  const { prisma, events } = csatFlowDeps(db, io, log);
  setupCsatScheduler(scheduler, { admin: db, prisma, io, events });
  const run = runs.get('csat-auto-close');
  assert.ok(run);
  return run;
}

function assertNothingClosed(emitted: string[]) {
  assert.equal(closedEvents().length, 0);
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

/**
 * 寄送延遲 30 分鐘（issue #339 決定 4，csat-survey「工單解決 30 分鐘後寄出問卷」）：
 * 排程只查 resolvedAt 早於「現在 − 30 分鐘」的工單。
 */
async function sendQueryCutoff(): Promise<Date> {
  const findManyArgs: Array<{ where: { resolvedAt: { lte: Date } } }> = [];
  const db = { case: { findMany: async (args: never) => { findManyArgs.push(args); return []; } } } as unknown as PrismaClient;
  const runs = new Map<string, () => Promise<void>>();
  const { io } = createIo();
  const { prisma, events } = csatFlowDeps(db, io);
  setupCsatScheduler({ registerSchedule: (def: { id: string; run: () => Promise<void> }) => runs.set(def.id, def.run) } as unknown as JobScheduler, { admin: db, prisma, io, events });
  await runs.get('csat-send')!();
  assert.equal(findManyArgs.length, 1);
  return findManyArgs[0].where.resolvedAt.lte;
}

test('解決未滿 30 分鐘不寄問卷', async () => {
  const cutoff = await sendQueryCutoff();
  const resolvedAt = new Date(Date.now() - 29 * 60 * 1000);
  assert.equal(resolvedAt <= cutoff, false, '29 分鐘前解決的工單不在查詢範圍');
});

test('解決滿 30 分鐘寄出問卷', async () => {
  const cutoff = await sendQueryCutoff();
  const resolvedAt = new Date(Date.now() - 31 * 60 * 1000);
  assert.equal(resolvedAt <= cutoff, true, '31 分鐘前解決的工單在查詢範圍');
});

test('問卷逾時沒有回覆，工單結案', async () => {
  const { db, updateManyCalls } = createDb(1);
  const { io, emitted } = createIo();

  await getAutoCloseRun(db, io)();

  assert.equal(updateManyCalls.length, 1);
  const { data } = updateManyCalls[0] as { data: Record<string, unknown> };
  assert.equal(data.status, 'CLOSED');
  assert.ok(data.closedAt instanceof Date);
  assert.equal(closedEvents().length, 1);
  assert.deepEqual(log.entries.slice(0, 2), ['event:case.closed', 'commit'], 'case.closed 與結案一起 commit');
  assert.equal(emitted.includes('case.updated'), true);
  assert.deepEqual(closedConversationsFor, [CASE_ID]);
});
