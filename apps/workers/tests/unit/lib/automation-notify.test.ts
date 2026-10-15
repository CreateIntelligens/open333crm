/**
 * 「傳送通知」的收件人（change fix-automation-rule-gaps，spec automation-engine「傳送通知的收件人」，問題清單 A03）。
 * 背景：原本只在工單有負責人時送，聯絡人、短連結、新對話等觸發選了這個動作永遠不會送。
 */
import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';

const { sent } = vi.hoisted(() => ({ sent: [] as Array<{ agentId: string; tenantId: string; clickUrl?: string }> }));
vi.mock('#src/lib/notification-queue.js', () => ({
  enqueueNotification: async (input: { agentId: string; tenantId: string; clickUrl?: string }) => {
    sent.push(input);
  },
}));

import { executeWorkerAutomationActions } from '#src/lib/automation-actions.js';

const TENANT = 't1';
const agents = [
  { id: 'agent-a', tenantId: TENANT, isActive: true, role: 'AGENT' },
  { id: 'agent-b', tenantId: TENANT, isActive: true, role: 'AGENT' },
  { id: 'agent-c', tenantId: TENANT, isActive: true, role: 'AGENT' },
  { id: 'agent-off', tenantId: TENANT, isActive: false, role: 'AGENT' },
  { id: 'agent-other', tenantId: 't2', isActive: true, role: 'AGENT' },
  { id: 'sup-1', tenantId: TENANT, isActive: true, role: 'SUPERVISOR' },
  { id: 'admin-1', tenantId: TENANT, isActive: true, role: 'ADMIN' },
  { id: 'sup-other', tenantId: 't2', isActive: true, role: 'SUPERVISOR' },
];

const conversations: Record<string, { assignedToId: string | null }> = {
  'conv-1': { assignedToId: 'agent-c' },
  'conv-off': { assignedToId: 'agent-off' },
  'conv-other': { assignedToId: 'agent-other' },
};

const prisma = {
  agent: {
    async findFirst({ where }: { where: { id: string; tenantId: string; isActive: boolean } }) {
      return agents.find((a) => a.id === where.id && a.tenantId === where.tenantId && a.isActive === where.isActive) ?? null;
    },
    async findMany({ where }: { where: { tenantId: string; role: { in: string[] }; isActive: boolean } }) {
      return agents.filter(
        (a) => a.tenantId === where.tenantId && where.role.in.includes(a.role) && a.isActive === where.isActive,
      );
    },
  },
  conversation: {
    async findFirst({ where }: { where: { id: string; tenantId: string } }) {
      if (where.tenantId !== TENANT) return null;
      return conversations[where.id] ?? null;
    },
  },
};
const redis = { publish: async () => 1 };

const notify = (params: Record<string, unknown> = {}) => [{ type: 'notify', params: { message: '請處理', ...params } }];

async function run(params: Record<string, unknown>, context: Record<string, unknown>) {
  await executeWorkerAutomationActions(prisma as never, redis as never, notify(params), { tenantId: TENANT, ...context });
  return sent.map((s) => s.agentId).sort();
}

beforeEach(() => {
  sent.length = 0;
});

test('指定客服', async () => {
  assert.deepEqual(await run({ agentId: 'agent-a' }, { trigger: 'contact.created', contactId: 'ct-1' }), ['agent-a']);
});

test('沒有指定，工單有負責人', async () => {
  assert.deepEqual(await run({}, { trigger: 'case.created', caseId: 'case-1', assigneeId: 'agent-b' }), ['agent-b']);
  assert.equal(sent[0]!.clickUrl, '/dashboard/cases/case-1');
});

test('沒有指定，對話有負責客服', async () => {
  assert.deepEqual(await run({}, { trigger: 'message.received', conversationId: 'conv-1' }), ['agent-c']);
  assert.equal(sent[0]!.clickUrl, '/dashboard/inbox?conv=conv-1');
});

test('沒有任何負責人', async () => {
  assert.deepEqual(await run({}, { trigger: 'link.clicked', contactId: 'ct-1' }), ['admin-1', 'sup-1']);
});

test('指定的客服已停用或屬於別的租戶', async () => {
  assert.deepEqual(await run({ agentId: 'agent-off' }, { trigger: 'case.created', caseId: 'case-1', assigneeId: 'agent-b' }), ['agent-b']);
  sent.length = 0;
  assert.deepEqual(await run({ agentId: 'agent-other' }, { trigger: 'case.created', caseId: 'case-1', assigneeId: 'agent-b' }), ['agent-b']);
});

test('工單負責人已停用或屬於別的租戶', async () => {
  assert.deepEqual(
    await run({}, { trigger: 'message.received', caseId: 'case-1', assigneeId: 'agent-off', conversationId: 'conv-1' }),
    ['agent-c'],
  );
  sent.length = 0;
  assert.deepEqual(
    await run({}, { trigger: 'case.created', caseId: 'case-1', assigneeId: 'agent-other' }),
    ['admin-1', 'sup-1'],
  );
});

test('對話負責客服已停用或屬於別的租戶', async () => {
  assert.deepEqual(await run({}, { trigger: 'message.received', conversationId: 'conv-off' }), ['admin-1', 'sup-1']);
  sent.length = 0;
  assert.deepEqual(await run({}, { trigger: 'message.received', conversationId: 'conv-other' }), ['admin-1', 'sup-1']);
});
