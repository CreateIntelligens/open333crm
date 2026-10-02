/**
 * create_case worker 動作（AUDIT AUTO-01 補實作）：條件命中時自動建立工單，行為與手動建立一致。
 */
import assert from 'node:assert/strict';
import { beforeEach, test } from 'vitest';
import { executeWorkerAutomationActions } from '#src/lib/automation-actions';

const T = 'tenant-1';
interface Conv { id: string; tenantId: string; contactId: string; channelId: string; caseId: string | null }
interface Case { id: string; tenantId: string; status: string; [k: string]: unknown }

let convs: Conv[];
let cases: Case[];
let events: Array<Record<string, unknown>>;
let published: Array<{ channel: string; msg: any }>;

beforeEach(() => {
  convs = [
    { id: 'conv-1', tenantId: T, contactId: 'contact-1', channelId: 'channel-1', caseId: null },
    { id: 'conv-other-tenant', tenantId: 'tenant-2', contactId: 'contact-9', channelId: 'channel-9', caseId: null },
  ];
  cases = [];
  events = [];
  published = [];
});

const prisma = {
  conversation: {
    async findFirst({ where }: { where: { id: string; tenantId: string } }) {
      return convs.find((c) => c.id === where.id && c.tenantId === where.tenantId) ?? null;
    },
    async updateMany({ where, data }: { where: { id: string; tenantId: string }; data: { caseId: string } }) {
      const c = convs.find((x) => x.id === where.id && x.tenantId === where.tenantId);
      if (c) c.caseId = data.caseId;
      return { count: c ? 1 : 0 };
    },
  },
  case: {
    async findFirst({ where }: { where: { id: string; tenantId: string } }) {
      return cases.find((c) => c.id === where.id && c.tenantId === where.tenantId) ?? null;
    },
    async create({ data }: { data: Record<string, unknown> }) {
      const c = { id: `case-${cases.length + 1}`, ...data } as Case;
      cases.push(c);
      return c;
    },
    async update({ where, data }: { where: { id: string }; data: Record<string, unknown> }) {
      const c = cases.find((x) => x.id === where.id)!;
      Object.assign(c, data);
      return c;
    },
    async updateMany({ where, data }: { where: { id: string; tenantId: string }; data: Record<string, unknown> }) {
      const c = cases.find((x) => x.id === where.id && x.tenantId === where.tenantId);
      if (c) Object.assign(c, data);
      return { count: c ? 1 : 0 };
    },
  },
  slaPolicy: {
    async findFirst({ where }: { where: { tenantId: string; priority: string } }) {
      return where.tenantId === T && where.priority === 'HIGH' ? { name: '高優先 SLA', resolutionMinutes: 120 } : null;
    },
  },
  caseEvent: {
    async create({ data }: { data: Record<string, unknown> }) {
      events.push(data);
      return data;
    },
  },
};
const redisPublisher = {
  async publish(channel: string, message: string) {
    published.push({ channel, msg: JSON.parse(message) });
    return 1;
  },
};
const run = (actions: Array<Record<string, unknown>>, ctx: Record<string, unknown>) =>
  executeWorkerAutomationActions(prisma as any, redisPublisher as any, actions as any, { tenantId: T, ...ctx } as any);

const createCase = (params: Record<string, unknown> = {}) => ({ type: 'create_case', params: { title: '客訴', ...params } });

test('收到訊息時建立工單：關聯對話、套用 SLA、寫事件、推播並發出 case.created', async () => {
  const before = Date.now();
  await run([createCase({ priority: 'HIGH', category: 'complaint' })], { trigger: 'message.received', conversationId: 'conv-1', contactId: 'contact-1' });
  assert.equal(cases.length, 1);
  const c = cases[0]!;
  assert.equal(c.tenantId, T);
  assert.equal(c.contactId, 'contact-1');
  assert.equal(c.channelId, 'channel-1');
  assert.equal(c.title, '客訴');
  assert.equal(c.priority, 'HIGH');
  assert.equal(c.category, 'complaint');
  assert.equal(c.status, 'OPEN');
  assert.equal(c.slaPolicy, '高優先 SLA');
  const due = (c.slaDueAt as Date).getTime();
  assert.ok(due >= before + 120 * 60_000 && due <= Date.now() + 120 * 60_000);
  assert.equal(convs[0]!.caseId, c.id, '對話要關聯到新工單');
  assert.equal(events.length, 1);
  assert.equal(events[0]!.actorType, 'automation');
  assert.equal(events[0]!.eventType, 'created');
  const socket = published.find((p) => p.msg.event === 'case.created');
  assert.ok(socket, '要推播 case.created');
  assert.equal(socket!.msg.room, `tenant:${T}`);
  const domain = published.find((p) => p.msg.name === 'case.created');
  assert.ok(domain, '要發出 case.created 讓通知與後續規則運作');
  assert.equal(domain!.msg.payload.caseId, c.id);
  assert.equal(domain!.msg.payload.conversationId, 'conv-1');
});

test('沒指定優先度：MEDIUM、沒有對應 SLA 政策時不設 SLA', async () => {
  await run([createCase()], { trigger: 'message.received', conversationId: 'conv-1', contactId: 'contact-1' });
  assert.equal(cases[0]!.priority, 'MEDIUM');
  assert.equal(cases[0]!.slaPolicy, null);
  assert.equal(cases[0]!.slaDueAt, null);
});

test('同一條規則的後續動作作用在新工單上', async () => {
  await run([createCase(), { type: 'assign_agent', params: { agentId: 'agent-7' } }], {
    trigger: 'message.received',
    conversationId: 'conv-1',
    contactId: 'contact-1',
  });
  assert.equal(cases[0]!.assigneeId, 'agent-7');
});

test('對話已有未結案的工單：不重複開', async () => {
  cases.push({ id: 'case-old', tenantId: T, status: 'IN_PROGRESS' });
  convs[0]!.caseId = 'case-old';
  await run([createCase()], { trigger: 'message.received', conversationId: 'conv-1', contactId: 'contact-1' });
  assert.equal(cases.length, 1);
  assert.equal(convs[0]!.caseId, 'case-old');
});

test('對話原本的工單已結案：開新單並改關聯', async () => {
  cases.push({ id: 'case-old', tenantId: T, status: 'CLOSED' });
  convs[0]!.caseId = 'case-old';
  await run([createCase()], { trigger: 'message.received', conversationId: 'conv-1', contactId: 'contact-1' });
  assert.equal(cases.length, 2);
  assert.equal(convs[0]!.caseId, cases[1]!.id);
});

test('沒有對話、對話屬於其他租戶：不建立', async () => {
  await run([createCase()], { trigger: 'message.received', contactId: 'contact-1' });
  await run([createCase()], { trigger: 'message.received', conversationId: 'conv-other-tenant', contactId: 'contact-9' });
  assert.equal(cases.length, 0);
});

test('工單或 SLA 事件觸發的規則：不建立工單（避免工單開工單的迴圈）', async () => {
  for (const trigger of ['case.created', 'case.status_changed', 'sla.first_response_breached']) {
    await run([createCase()], { trigger, conversationId: 'conv-1', contactId: 'contact-1', caseId: 'case-x' });
  }
  assert.equal(cases.length, 0);
});
