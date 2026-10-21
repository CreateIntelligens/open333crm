/**
 * workers 處理 message.received 時一併評估關鍵字規則（change outbox-event-delivery：automation-engine
 * 「關鍵字規則在處理收到的訊息時比對」「keyword.matched 每則訊息每條規則最多發出一次」）。
 *
 * 規則動作換成記錄呼叫的假實作（LINE 用 reply 的行為見 tests/unit/lib/automation-keyword-reply.test.ts）。
 * 佇列換成記錄 add() 的假實作；資料庫是記憶體裡的假交易。
 */
import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';

const executed = vi.hoisted(() => [] as Array<{ actions: unknown[]; context: Record<string, unknown> }>);
const queued = vi.hoisted(() => [] as Array<{ name: string; opts?: Record<string, unknown> }>);

vi.mock('#src/lib/automation-actions.js', () => ({
  executeWorkerAutomationActions: async (_p: unknown, _r: unknown, actions: unknown[], context: Record<string, unknown>) => {
    executed.push({ actions, context });
  },
}));
vi.mock('bullmq', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Queue: class {
    async add(name: string, _data: unknown, opts?: Record<string, unknown>) {
      queued.push({ name, opts });
    }
  },
}));

const { handleAutomationJob } = await import('#src/handlers/automation.handler.js');

const TENANT = 'a0000000-0000-0000-0000-000000000001';
const MESSAGE = 'b0000000-0000-0000-0000-00000000000b';
const EVENT = 'e0000000-0000-0000-0000-00000000000e';

function keywordRule(id: string, keywords: string[]) {
  return {
    id,
    name: id,
    priority: 10,
    stopOnMatch: false,
    eventType: 'keyword.matched',
    trigger: { type: 'keyword.matched', keywords },
    conditions: { all: [] },
    actions: [{ type: 'send_message', params: { text: '營業時間是 9 點到 18 點' } }],
  };
}

function fakeDb() {
  const claims = new Set<string>();
  const outbox: Array<{ name: string; payload: Record<string, unknown> }> = [];
  const rules = [keywordRule('rule-hours', ['營業時間']), keywordRule('rule-address', ['地址'])];
  const db: Record<string, unknown> = {
    automationRule: {
      findMany: async ({ where }: { where: { eventType: string } }) => rules.filter((r) => r.eventType === where.eventType),
    },
    sideEffectClaim: {
      createMany: async ({ data }: { data: Array<{ kind: string; sourceId: string; subKey: string }> }) => {
        const key = `${data[0].kind}|${data[0].sourceId}|${data[0].subKey}`;
        if (claims.has(key)) return { count: 0 };
        claims.add(key);
        return { count: 1 };
      },
    },
    outbox: {
      create: async ({ data }: { data: { name: string; payload: Record<string, unknown>; tenantId: string; kind: string } }) => {
        const row = { id: crypto.randomUUID(), ...data, queueName: null, jobOptions: null, createdAt: new Date() };
        outbox.push(row);
        return row;
      },
      updateMany: async () => ({ count: 1 }),
    },
    contact: { findFirst: async () => null },
    conversation: { findFirst: async () => null },
    case: { findFirst: async () => null, count: async () => 0 },
  };
  db.$transaction = async (fn: (tx: unknown) => Promise<unknown>) => fn(db);
  return { db, outbox };
}

const redis = { publish: async () => 1 };

function job(text: string) {
  return {
    data: {
      tenantId: TENANT,
      eventId: EVENT,
      trigger: 'message.received',
      context: { conversationId: 'conv-1', contactId: 'contact-1', messageId: MESSAGE, messageContent: text, channelType: 'LINE', replyToken: 'rt-1' },
    },
  } as never;
}

beforeEach(() => {
  executed.length = 0;
  queued.length = 0;
});

test('訊息命中關鍵字規則：以 keyword.matched 執行命中的規則，帶 replyToken，未命中的規則不執行', async () => {
  const { db } = fakeDb();
  await handleAutomationJob(job('請問營業時間'), db as never, redis as never);

  assert.equal(executed.length, 1);
  assert.equal(executed[0].context.trigger, 'keyword.matched');
  assert.equal(executed[0].context.replyToken, 'rt-1');
  assert.equal(executed[0].context.ruleId, 'rule-hours');
  assert.equal(executed[0].context.eventId, EVENT);
});

test('訊息沒有命中：不執行任何 keyword.matched 規則，也不發出 keyword.matched', async () => {
  const { db, outbox } = fakeDb();
  await handleAutomationJob(job('你好'), db as never, redis as never);
  assert.deepEqual(executed, []);
  assert.deepEqual(outbox, []);
});

test('同一則訊息評估兩次：只發出一個 rule-hours 的 keyword.matched', async () => {
  const { db, outbox } = fakeDb();
  await handleAutomationJob(job('請問營業時間'), db as never, redis as never);
  await handleAutomationJob(job('請問營業時間'), db as never, redis as never);

  const matched = outbox.filter((o) => o.name === 'keyword.matched');
  assert.equal(matched.length, 1);
  assert.equal(matched[0].payload.ruleId, 'rule-hours');
  assert.deepEqual(matched[0].payload.matchedKeywords, ['營業時間']);
});
