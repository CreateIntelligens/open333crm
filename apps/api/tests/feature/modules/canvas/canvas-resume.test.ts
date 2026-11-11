/**
 * Canvas 等待節點的喚醒（issue #334，change fix-canvas-wait-resume，spec interaction-canvas）。
 *
 * 用真實的 PostgreSQL：認領靠資料庫的條件更新與列鎖，mock 證明不了「兩次同時喚醒只執行一次」。
 * 掃描用 owner（正式環境是 prismaAdmin），認領在 app_tenant 連線的 withTenant 交易內（RLS 生效）。
 * FlowRunner 本身仍用 module-level singleton（AUDIT RLS-01），測試庫的 DATABASE_URL 指向 owner。
 */
import assert from 'node:assert/strict';
import { afterAll, afterEach, describe, test, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { FlowRunner } from '@open333crm/core';
import { createCanvasFixture } from './canvas-test-app.js';
import { setupCanvasScheduler } from '#src/modules/canvas/canvas.scheduler.js';
import type { JobScheduler, ScheduleDefinition } from '#src/lib/job-scheduler.js';

const fx = await createCanvasFixture('resume');
const tenantDb = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TENANT } } });
afterAll(async () => {
  await fx.cleanup();
  await tenantDb.$disconnect();
});

const contactA = await fx.contactOf(fx.A, 'contact-a');

afterEach(() => {
  vi.restoreAllMocks();
});

/** 取得 canvas.scheduler.ts 註冊的 canvas-resume 排程，以測試的連線呼叫 */
function canvasResumeRun(admin: PrismaClient) {
  const defs: ScheduleDefinition[] = [];
  const scheduler: JobScheduler = { registerSchedule: (def) => void defs.push(def), start: () => {}, close: async () => {} };
  setupCanvasScheduler(scheduler, { admin, prisma: tenantDb });
  return defs[0].run;
}

/** 建立一個停在等待節點、resumeAt 已過的 execution（與 FlowRunner 暫停時寫入的形狀相同） */
async function waitingExecution(label: string, resumeAt = new Date(Date.now() - 60_000)) {
  const flow = await fx.owner.interactionFlow.create({
    data: { tenantId: fx.A, name: `${fx.mark}-${label}`, triggerType: 'manual', status: 'ACTIVE' },
  });
  const trigger = await fx.owner.interactionNode.create({
    data: { flowId: flow.id, nodeType: 'TRIGGER', label: 'trigger', config: {}, position: {} },
  });
  const after = await fx.owner.interactionNode.create({
    // CONDITION 沒有外部副作用；判斷為否且沒有 falseNodeId，執行完就結束
    data: { flowId: flow.id, nodeType: 'CONDITION', label: 'after-wait', config: { field: 'x', operator: 'exists' }, position: {} },
  });
  const wait = await fx.owner.interactionNode.create({
    data: { flowId: flow.id, nodeType: 'WAIT', label: 'wait', config: { delayMinutes: 1 }, position: {}, nextNodeId: after.id },
  });
  await fx.owner.interactionNode.update({ where: { id: trigger.id }, data: { nextNodeId: wait.id } });
  const execution = await fx.owner.flowExecution.create({
    data: {
      tenantId: fx.A,
      flowId: flow.id,
      contactId: contactA.id,
      status: 'WAITING',
      currentNodeId: wait.id,
      stepCount: 2,
      resumeAt,
    },
  });
  return { execution, wait, after };
}

describe('等待節點喚醒後從下一個節點繼續', () => {
  test('喚醒後從等待節點的下一個節點繼續', async () => {
    const { execution, wait, after } = await waitingExecution('resume-next');
    // 排程不等 FlowRunner 跑完；記下這筆 execution 的執行，等它結束再檢查。其他測試留下的 execution 不執行
    const runs: Promise<void>[] = [];
    const original = FlowRunner.run.bind(FlowRunner);
    vi.spyOn(FlowRunner, 'run').mockImplementation((id, options) => {
      if (id !== execution.id) return Promise.resolve();
      const p = original(id, options);
      runs.push(p);
      return p;
    });

    await canvasResumeRun(fx.owner)();
    await vi.waitFor(() => assert.equal(runs.length, 1));
    await Promise.all(runs);

    const row = await fx.owner.flowExecution.findUniqueOrThrow({ where: { id: execution.id } });
    assert.equal(row.status, 'COMPLETED', `喚醒後應該完成，實際 ${row.status}（${row.errorMessage ?? ''}）`);
    const logs = await fx.owner.flowLog.findMany({ where: { executionId: execution.id }, orderBy: { createdAt: 'asc' } });
    assert.equal(logs.filter((l) => l.action === 'wait_scheduled').length, 0, '不應該再執行一次等待節點');
    assert.deepEqual(
      logs.filter((l) => l.action === 'node_entered').map((l) => l.nodeId),
      [after.id],
    );
    assert.ok(logs.some((l) => l.action === 'wait_resumed' && l.nodeId === wait.id));
  });
});

describe('同一次喚醒只執行一次', () => {
  test('兩次喚醒同時執行時只恢復一次', async () => {
    const { execution } = await waitingExecution('concurrent');
    const runSpy = vi.spyOn(FlowRunner, 'run').mockResolvedValue(undefined);

    // 兩邊都查到這筆到期的 execution 之後，才一起去認領：重現「鎖過期後兩期同時執行」
    let arrived = 0;
    let release!: () => void;
    const bothScanned = new Promise<void>((resolve) => (release = resolve));
    const barrierAdmin = new Proxy(fx.owner, {
      get(target, prop, receiver) {
        if (prop !== 'flowExecution') return Reflect.get(target, prop, receiver);
        return {
          findMany: async (args: Parameters<typeof target.flowExecution.findMany>[0]) => {
            const rows = await target.flowExecution.findMany(args);
            if (++arrived === 2) release();
            await bothScanned;
            return rows;
          },
        };
      },
    });

    const run = canvasResumeRun(barrierAdmin);
    await Promise.all([run(), run()]);

    const calls = runSpy.mock.calls.filter(([id]) => id === execution.id);
    assert.equal(calls.length, 1, `同一個 execution 應該只恢復一次，實際 ${calls.length} 次`);
    const row = await fx.owner.flowExecution.findUniqueOrThrow({ where: { id: execution.id } });
    assert.equal(row.status, 'RUNNING');
    assert.equal(row.resumeAt, null);
  });

  test('時間還沒到的等待不會被喚醒', async () => {
    const { execution } = await waitingExecution('not-due', new Date(Date.now() + 3_600_000));
    const runSpy = vi.spyOn(FlowRunner, 'run').mockResolvedValue(undefined);

    await canvasResumeRun(fx.owner)();

    assert.equal(runSpy.mock.calls.filter(([id]) => id === execution.id).length, 0);
    const row = await fx.owner.flowExecution.findUniqueOrThrow({ where: { id: execution.id } });
    assert.equal(row.status, 'WAITING');
  });

  test('已被認領的 execution 不會再被恢復', async () => {
    const { execution } = await waitingExecution('claimed');
    const runSpy = vi.spyOn(FlowRunner, 'run').mockResolvedValue(undefined);
    const { flowExecution } = fx.owner;
    // 掃描讀到 WAITING，但認領之前另一期已經改成 RUNNING
    const staleAdmin = new Proxy(fx.owner, {
      get(target, prop, receiver) {
        if (prop !== 'flowExecution') return Reflect.get(target, prop, receiver);
        return {
          findMany: async (args: Parameters<typeof flowExecution.findMany>[0]) => {
            const rows = await flowExecution.findMany(args);
            await flowExecution.update({ where: { id: execution.id }, data: { status: 'RUNNING', resumeAt: null } });
            return rows;
          },
        };
      },
    });

    await canvasResumeRun(staleAdmin)();

    assert.equal(runSpy.mock.calls.filter(([id]) => id === execution.id).length, 0);
  });
});
