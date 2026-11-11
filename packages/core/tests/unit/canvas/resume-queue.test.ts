/**
 * processResumeQueue 的認領流程（issue #334，change fix-canvas-wait-resume）。
 *
 * 這裡只驗證呼叫順序與條件：每筆在 execution 所屬租戶的交易內認領，認領失敗不恢復。
 * 「兩次同時喚醒只恢復一次」要靠資料庫的列鎖，見 apps/api/tests/feature/modules/canvas/canvas-resume.test.ts。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { processResumeQueue, type ResumeClaimDb, type ResumeScanDb } from '#src/canvas/scheduler.js';

const NOW = new Date('2026-11-11T00:00:00Z');

function setup(due: Array<{ id: string; tenantId: string }>, counts: Record<string, number | Error>) {
  const scans: unknown[] = [];
  const claims: Array<{ tenantId: string; where: Record<string, unknown>; data: Record<string, unknown> }> = [];
  const resumed: string[] = [];

  const admin = {
    flowExecution: {
      findMany: async (args: unknown) => {
        scans.push(args);
        return due;
      },
    },
  } as unknown as ResumeScanDb;

  const inTenant = async <T>(tenantId: string, fn: (tx: ResumeClaimDb) => Promise<T>): Promise<T> => {
    const tx = {
      flowExecution: {
        updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          claims.push({ tenantId, where, data });
          const result = counts[where.id as string];
          if (result instanceof Error) throw result;
          return { count: result ?? 0 };
        },
      },
    } as unknown as ResumeClaimDb;
    return fn(tx);
  };

  const run = () =>
    processResumeQueue({
      admin,
      inTenant,
      now: NOW,
      resumeFlow: async (id) => void resumed.push(id),
    });
  return { run, scans, claims, resumed };
}

test('只掃描到期的 WAITING execution', async () => {
  const { run, scans } = setup([], {});
  await run();
  assert.equal(scans.length, 1);
  assert.deepEqual((scans[0] as { where: unknown }).where, { status: 'WAITING', resumeAt: { lte: NOW } });
});

test('在 execution 所屬租戶的交易內以條件更新認領，認領成功才恢復', async () => {
  const { run, claims, resumed } = setup(
    [
      { id: 'e1', tenantId: 't1' },
      { id: 'e2', tenantId: 't2' },
    ],
    { e1: 1, e2: 0 },
  );
  await run();

  assert.deepEqual(claims, [
    {
      tenantId: 't1',
      where: { id: 'e1', tenantId: 't1', status: 'WAITING', resumeAt: { lte: NOW } },
      data: { status: 'RUNNING', resumeAt: null },
    },
    {
      tenantId: 't2',
      where: { id: 'e2', tenantId: 't2', status: 'WAITING', resumeAt: { lte: NOW } },
      data: { status: 'RUNNING', resumeAt: null },
    },
  ]);
  assert.deepEqual(resumed, ['e1'], '認領失敗（count 0）的 execution 不應該恢復');
});

test('一筆認領失敗不影響其他 execution', async () => {
  const { run, resumed } = setup(
    [
      { id: 'e1', tenantId: 't1' },
      { id: 'e2', tenantId: 't1' },
    ],
    { e1: new Error('connection reset'), e2: 1 },
  );
  await run();
  assert.deepEqual(resumed, ['e2']);
});
