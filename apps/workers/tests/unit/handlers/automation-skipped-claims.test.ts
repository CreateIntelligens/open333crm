/**
 * workers 的 automation processor 以回傳值列出被認領擋下的規則動作
 * （change queue-monitoring：queue-monitoring「被認領擋下的副作用標示跳過」）。
 *
 * 規則動作與認領走真實的程式，只有資料庫是記憶體裡的假交易。動作是 add_tag，
 * job 的 context 沒有聯絡人，所以動作執行時直接略過，不碰其他資料表。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { processAutomationJob } from '#src/handlers/automation.handler';

const TENANT = 'a0000000-0000-0000-0000-000000000001';
const EVENT = 'e0000000-0000-0000-0000-00000000000e';

function fakeDb(existingClaims: string[] = []) {
  const claims = new Set(existingClaims);
  const db: Record<string, unknown> = {
    automationRule: {
      findMany: async ({ where }: { where: { eventType: string } }) =>
        where.eventType === 'contact.created'
          ? [
              {
                id: 'rule-a',
                name: 'rule-a',
                priority: 10,
                stopOnMatch: false,
                eventType: 'contact.created',
                conditions: { all: [] },
                actions: [{ type: 'add_tag', params: { tagName: 'VIP' } }],
              },
            ]
          : [],
    },
    sideEffectClaim: {
      createMany: async ({ data }: { data: Array<{ kind: string; sourceId: string; subKey: string }> }) => {
        const key = `${data[0].kind}|${data[0].sourceId}|${data[0].subKey}`;
        if (claims.has(key)) return { count: 0 };
        claims.add(key);
        return { count: 1 };
      },
    },
    contact: { findFirst: async () => null },
    conversation: { findFirst: async () => null },
    case: { findFirst: async () => null, count: async () => 0 },
  };
  db.$transaction = async (fn: (tx: unknown) => Promise<unknown>) => fn(db);
  return db;
}

const redis = { publish: async () => 1 };

const job = {
  id: 'job-1',
  name: 'automation:evaluate',
  data: { tenantId: TENANT, eventId: EVENT, trigger: 'contact.created', context: {} },
} as never;

test('重送已執行過規則動作的 job', async () => {
  const db = fakeDb([`automation_action|${EVENT}|rule-a#0`]);

  const result = await processAutomationJob(job, db as never, redis as never);

  assert.deepEqual(result, {
    skippedClaims: [{ kind: 'automation_action', sourceId: EVENT, subKey: 'rule-a#0' }],
  });
});

test('第一次執行沒有跳過', async () => {
  const db = fakeDb();

  const result = await processAutomationJob(job, db as never, redis as never);

  assert.equal(result, undefined);
});
