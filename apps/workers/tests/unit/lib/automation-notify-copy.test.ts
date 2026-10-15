/**
 * 自動化「通知」動作的站內通知標題（S12）：原本是英文「SLA rule matched」。
 */
import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';

const { notifications } = vi.hoisted(() => ({
  notifications: [] as Array<{ agentId: string; type: string; title: string; body: string }>,
}));
vi.mock('#src/lib/notification-queue', () => ({
  enqueueNotification: async (input: { agentId: string; type: string; title: string; body: string }) => {
    notifications.push(input);
  },
}));

import { executeWorkerAutomationActions } from '#src/lib/automation-actions';

const prisma: any = {
  agent: {
    async findMany() { return [{ id: 'supervisor-1' }]; },
    // 「傳送通知」會先確認收件人是同租戶、啟用中的客服（#282 的收件人驗證）
    async findFirst({ where }: { where: { id: string } }) { return where.id === 'agent-1' ? { id: 'agent-1' } : null; },
  },
};

beforeEach(() => {
  notifications.length = 0;
});

test('通知負責人與主管：沒有自訂訊息時標題與內容都是中文', async () => {
  await executeWorkerAutomationActions(
    prisma,
    {} as any,
    [
      { type: 'notify', params: {} },
      { type: 'notify_supervisor', params: {} },
    ],
    { tenantId: 't-1', caseId: 'case-1', assigneeId: 'agent-1', title: '冷氣不冷' },
  );

  assert.equal(notifications.length, 2);
  for (const n of notifications) {
    assert.ok(!/rule matched/i.test(n.title + n.body), `通知仍是英文：${n.title} / ${n.body}`);
    assert.match(n.title, /[一-鿿]/);
    assert.match(n.body, /[一-鿿]/);
  }
});
