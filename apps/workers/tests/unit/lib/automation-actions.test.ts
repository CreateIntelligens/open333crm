/**
 * 規則動作每個事件最多執行一次（change outbox-event-delivery：automation-engine「規則動作每個事件最多執行一次」）。
 *
 * 送出訊息、推播與站內通知換成記錄呼叫的假實作；資料庫是記憶體裡的假交易。
 */
import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';

const calls = vi.hoisted(() => ({
  sent: [] as unknown[],
  notified: [] as Array<{ agentId: string; jobId?: string }>,
}));

vi.mock('#src/lib/channel-delivery.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  deliverToChannelFromWorker: async (_p: unknown, _r: unknown, _reg: unknown, _c: string, payload: unknown) => {
    calls.sent.push(payload);
    return true;
  },
}));
vi.mock('#src/lib/socket-bridge.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  publishSocketEvent: async () => {},
}));
vi.mock('#src/lib/notification-queue.js', () => ({
  enqueueNotification: async (input: { agentId: string }, opts?: { jobId?: string }) => {
    calls.notified.push({ agentId: input.agentId, jobId: opts?.jobId });
  },
}));

const { executeWorkerAutomationActions } = await import('#src/lib/automation-actions.js');

const TENANT = 'a0000000-0000-0000-0000-000000000001';
const E1 = 'e1000000-0000-0000-0000-000000000001';
const E2 = 'e2000000-0000-0000-0000-000000000002';

function fakeDb() {
  const claims = new Set<string>();
  const caseRow = { id: 'case-1', priority: 'LOW' };
  const db: Record<string, unknown> = {
    sideEffectClaim: {
      createMany: async ({ data }: { data: Array<{ kind: string; sourceId: string; subKey: string }> }) => {
        const key = `${data[0].kind}|${data[0].sourceId}|${data[0].subKey}`;
        if (claims.has(key)) return { count: 0 };
        claims.add(key);
        return { count: 1 };
      },
    },
    case: {
      findUnique: async () => ({ priority: caseRow.priority }),
      update: async ({ data }: { data: { priority: string } }) => {
        caseRow.priority = data.priority;
        return caseRow;
      },
    },
    agent: { findFirst: async ({ where }: { where: { id: string } }) => ({ id: where.id }) },
  };
  db.$transaction = async (fn: (tx: unknown) => Promise<unknown>) => fn(db);
  return { db, claims, caseRow };
}

const redis = { publish: async () => 1 };
const sendMessage = [{ type: 'send_message', params: { text: '您好' } }];

function context(eventId: string | null) {
  return {
    tenantId: TENANT,
    eventId,
    ruleId: 'rule-r',
    conversationId: 'conv-1',
    caseId: 'case-1',
    pluginRegistry: new Map(),
  };
}

beforeEach(() => {
  calls.sent.length = 0;
  calls.notified.length = 0;
});

test('同一個事件評估兩次：客人只收到一則訊息', async () => {
  const { db } = fakeDb();
  await executeWorkerAutomationActions(db as never, redis as never, sendMessage, context(E1));
  await executeWorkerAutomationActions(db as never, redis as never, sendMessage, context(E1));
  assert.equal(calls.sent.length, 1);
});

test('升級工單不重複升級：沒有指定優先度的 escalate_case 執行兩次，LOW 只升到 MEDIUM', async () => {
  const { db, caseRow } = fakeDb();
  const escalate = [{ type: 'escalate_case', params: {} }];
  await executeWorkerAutomationActions(db as never, redis as never, escalate, context(E1));
  await executeWorkerAutomationActions(db as never, redis as never, escalate, context(E1));
  assert.equal(caseRow.priority, 'MEDIUM');
});

test('不同事件各自執行：E1 與 E2 都觸發 send_message，客人收到兩則', async () => {
  const { db } = fakeDb();
  await executeWorkerAutomationActions(db as never, redis as never, sendMessage, context(E1));
  await executeWorkerAutomationActions(db as never, redis as never, sendMessage, context(E2));
  assert.equal(calls.sent.length, 2);
});

test('沒有事件 id（SLA 路徑）：不寫認領紀錄，動作照常執行', async () => {
  const { db, claims } = fakeDb();
  await executeWorkerAutomationActions(db as never, redis as never, sendMessage, context(null));
  await executeWorkerAutomationActions(db as never, redis as never, sendMessage, context(null));
  assert.equal(claims.size, 0);
  assert.equal(calls.sent.length, 2);
});

test('notify 的 job id 是 <事件 id>__<規則 id>#<序號>__<客服人員 id>', async () => {
  const { db } = fakeDb();
  const notify = [{ type: 'send_message', params: { text: 'x' } }, { type: 'notify', params: { agentId: 'agent-x' } }];
  await executeWorkerAutomationActions(db as never, redis as never, notify, context(E1));
  assert.deepEqual(calls.notified.map((n) => n.jobId), [`${E1}__rule-r#1__agent-x`]);
});
