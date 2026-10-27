import assert from 'node:assert/strict';
import { test, vi } from 'vitest';

const executed = vi.hoisted(() => [] as Array<{ actions: unknown[]; context: Record<string, unknown> }>);
vi.mock('#src/lib/automation-actions.js', () => ({
  executeWorkerAutomationActions: async (_p: unknown, _r: unknown, actions: unknown[], context: Record<string, unknown>) => {
    executed.push({ actions, context });
  },
}));
// keyword.matched 的 outbox 快路徑會送進佇列；換成不連 Redis 的假佇列
vi.mock('bullmq', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Queue: class {
    async add() {
      return {};
    }
  },
}));

const { handleAutomationJob } = await import('#src/handlers/automation.handler.js');

async function testKeywordMatchedJobScopesCandidateRuleByMatchedRuleId() {
  const findManyCalls: unknown[] = [];
  const rules = [
    {
      id: 'rule-test',
      name: 'test keyword',
      priority: 10,
      stopOnMatch: false,
      conditions: { all: [] },
      actions: [],
    },
    {
      id: 'rule-line-text',
      name: 'line_text keyword',
      priority: 10,
      stopOnMatch: false,
      conditions: { all: [] },
      actions: [],
    },
  ];

  const prisma = {
    automationRule: {
      async findMany(args: { where: { id?: string } }) {
        findManyCalls.push(args);
        return args.where.id
          ? rules.filter((rule) => rule.id === args.where.id)
          : rules;
      },
    },
  };

  const publishCalls: unknown[] = [];
  const redisPublisher = {
    async publish(channel: string, payload: string) {
      publishCalls.push({ channel, payload });
      return 1;
    },
  };

  await handleAutomationJob(
    {
      data: {
        tenantId: 'tenant-1',
        trigger: 'keyword.matched',
        context: {
          ruleId: 'rule-test',
          messageContent: 'test',
          matchedKeywords: ['test'],
        },
      },
    } as any,
    prisma as any,
    redisPublisher as any,
  );

  assert.equal(findManyCalls.length, 1);
  assert.deepEqual(findManyCalls[0], {
    where: {
      tenantId: 'tenant-1',
      eventType: 'keyword.matched',
      isActive: true,
      id: 'rule-test',
    },
  });
  assert.equal(publishCalls.length, 1);
  assert.match(JSON.stringify(publishCalls[0]), /rule-test/);
  assert.doesNotMatch(JSON.stringify(publishCalls[0]), /rule-line-text/);
}

test('keyword matched job scopes candidate rule by matched rule id', testKeywordMatchedJobScopesCandidateRuleByMatchedRuleId);

// ── 關鍵字回覆頁的規則只在 LINE 生效（add-coupon-system A15 15.2、design D25；
//    spec coupon-management「關鍵字回覆可以同時發券」）──

test('Facebook 對話傳送同樣的關鍵字：規則帶「對話渠道等於 LINE」，條件不成立，不發券', async () => {
  executed.length = 0;
  const rule = {
    id: 'rule-coupon',
    name: '秋季領券',
    priority: 10,
    stopOnMatch: false,
    eventType: 'keyword.matched',
    trigger: { type: 'keyword.matched', keywords: ['領券'], match_mode: 'any' },
    conditions: { all: [{ fact: 'conversation.channelType', operator: 'equal', value: 'LINE' }] },
    actions: [{ type: 'issue_coupon', params: { couponId: 'coupon-1' } }],
  };
  const db: Record<string, unknown> = {
    automationRule: {
      findMany: async ({ where }: { where: { eventType: string } }) => (where.eventType === rule.eventType ? [rule] : []),
    },
    sideEffectClaim: { createMany: async () => ({ count: 1 }) },
    outbox: {
      create: async ({ data }: { data: Record<string, unknown> }) => ({ id: crypto.randomUUID(), ...data, queueName: null, jobOptions: null, createdAt: new Date() }),
      updateMany: async () => ({ count: 1 }),
    },
    contact: { findFirst: async () => null },
    conversation: {
      findFirst: async ({ where }: { where: { id: string; tenantId: string } }) =>
        where.id === 'conv-fb' && where.tenantId === 'tenant-1'
          ? { channelType: 'FB', status: 'ACTIVE', assignedToId: null, caseId: null }
          : null,
    },
    case: { findFirst: async () => null, count: async () => 0 },
  };
  db.$transaction = async (fn: (tx: unknown) => Promise<unknown>) => fn(db);

  await handleAutomationJob(
    {
      data: {
        tenantId: 'tenant-1',
        eventId: crypto.randomUUID(),
        trigger: 'message.received',
        context: { conversationId: 'conv-fb', contactId: 'contact-1', messageId: crypto.randomUUID(), messageContent: '我要領券', channelType: 'FB' },
      },
    } as never,
    db as never,
    { publish: async () => 1 } as never,
  );

  assert.deepEqual(executed, []);
});
