/**
 * 升級工單時依「通知對象」算出要通知的客服（change fix-w6-field-validation，spec case-management
 * 「Escalation Notifies The Selected Targets」；UAT E2E BUG-W6-06）。
 *
 * 原本通知 worker 不讀 notifyTargets，一律通知主管與管理員，升級視窗的「通知原指派人」沒有作用。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { resolveEscalationRecipients } from '#src/modules/notification/notification.service.js';

const T = 'tenant-a';

type Agent = { id: string; tenantId: string; role: 'ADMIN' | 'SUPERVISOR' | 'AGENT'; isActive: boolean };

/** 支援 resolveEscalationRecipients 用到的 agent.findMany 條件（tenantId、role in、id in、isActive） */
function fakeDb(agents: Agent[]) {
  return {
    agent: {
      async findMany({ where }: { where: Record<string, unknown> }) {
        return agents
          .filter((a) => a.tenantId === where.tenantId)
          .filter((a) => where.isActive === undefined || a.isActive === where.isActive)
          .filter((a) => {
            const role = where.role as { in?: string[] } | undefined;
            return !role?.in || role.in.includes(a.role);
          })
          .filter((a) => {
            const id = where.id as { in?: string[] } | string | undefined;
            if (id === undefined) return true;
            return typeof id === 'string' ? a.id === id : !id.in || id.in.includes(a.id);
          })
          .map((a) => ({ id: a.id }));
      },
    },
  } as never;
}

const agents: Agent[] = [
  { id: 'admin', tenantId: T, role: 'ADMIN', isActive: true },
  { id: 'sup', tenantId: T, role: 'SUPERVISOR', isActive: true },
  { id: 'sup-off', tenantId: T, role: 'SUPERVISOR', isActive: false },
  { id: 'agent-a', tenantId: T, role: 'AGENT', isActive: true },
  { id: 'agent-b', tenantId: T, role: 'AGENT', isActive: true },
  { id: 'agent-off', tenantId: T, role: 'AGENT', isActive: false },
  { id: 'other-tenant-agent', tenantId: 'tenant-b', role: 'AGENT', isActive: true },
];
const db = fakeDb(agents);
const sorted = (ids: string[]) => [...ids].sort();

test('Notify the original assignee：只通知升級前的指派人，不通知主管', async () => {
  const ids = await resolveEscalationRecipients(db, T, {
    notifyTargets: ['original_assignee'],
    previousAssigneeId: 'agent-b',
    actorId: 'agent-a',
  });
  assert.deepEqual(ids, ['agent-b']);
});

test('Notify supervisors and the original assignee：原指派人也是主管時只通知一次', async () => {
  const ids = await resolveEscalationRecipients(db, T, {
    notifyTargets: ['supervisor', 'original_assignee'],
    previousAssigneeId: 'sup',
    actorId: 'agent-a',
  });
  assert.deepEqual(sorted(ids), ['admin', 'sup']);
});

test('Escalating agent is the original assignee：不通知升級的客服本人', async () => {
  const ids = await resolveEscalationRecipients(db, T, {
    notifyTargets: ['original_assignee'],
    previousAssigneeId: 'agent-b',
    actorId: 'agent-b',
  });
  assert.deepEqual(ids, []);
});

test('No notify targets given：沒帶通知對象時只通知在職的主管與管理員', async () => {
  const ids = await resolveEscalationRecipients(db, T, {
    previousAssigneeId: 'agent-b',
    actorId: 'agent-a',
  });
  assert.deepEqual(sorted(ids), ['admin', 'sup']);
});

test('Empty notify targets：空陣列不送通知', async () => {
  const ids = await resolveEscalationRecipients(db, T, {
    notifyTargets: [],
    previousAssigneeId: 'agent-b',
    actorId: 'agent-a',
  });
  assert.deepEqual(ids, []);
});

test('原指派人已停用、不存在或屬於其他租戶時不通知', async () => {
  for (const previousAssigneeId of ['agent-off', 'nobody', 'other-tenant-agent', null]) {
    const ids = await resolveEscalationRecipients(db, T, {
      notifyTargets: ['original_assignee'],
      previousAssigneeId,
      actorId: 'agent-a',
    });
    assert.deepEqual(ids, [], `previousAssigneeId=${previousAssigneeId}`);
  }
});
