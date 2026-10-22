/**
 * 通知訂閱者的 job id（change outbox-event-delivery：standalone-worker-runtime「同一個事件不重複建立站內通知」、
 * usage-quota-alerts「事件重送時不重複寄出告警信」）。
 *
 * 佇列換成記錄 add() 的假實作。BullMQ 以 job id 擋住重複的 job（見 tests/feature/lib/outbox-dedupe.test.ts），
 * 所以這裡斷言同一個事件處理兩次時，job id 相同。
 */
process.env.DATABASE_URL ||= 'postgresql://user:pass@localhost:5432/open333crm';
process.env.REDIS_URL ||= 'redis://localhost:6379';
process.env.JWT_SECRET ||= 'test-notification-worker-jwt-secret';
process.env.CREDENTIAL_ENCRYPTION_KEY ||= 'test-credential-encryption-key-32-bytes!!';
process.env.WEB_BASE_URL = 'https://crm.example';

import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';

const sent = vi.hoisted(() => ({
  jobs: [] as Array<{ queue: string; name: string; data: Record<string, unknown>; opts?: Record<string, unknown> }>,
  emails: [] as string[],
  redisDown: false,
}));
vi.mock('bullmq', async (importOriginal) => ({
  ...(await importOriginal<typeof import('bullmq')>()),
  Queue: class {
    constructor(private readonly queueName: string) {}
    async add(name: string, data: Record<string, unknown>, opts?: Record<string, unknown>) {
      if (sent.redisDown) throw new Error('redis down');
      sent.jobs.push({ queue: this.queueName, name, data, opts });
    }
  },
}));
vi.mock('#src/modules/email/email.service.js', () => ({
  sendEmail: async (input: { to: string }) => {
    sent.emails.push(input.to);
  },
}));

import { USAGE_ALERT_EMAIL_QUEUE } from '@open333crm/core';
import { loadEnvConfig } from '#src/config/env.js';
import { setupNotificationWorker } from '#src/modules/notification/notification.worker.js';

loadEnvConfig();

const TENANT = '11111111-1111-4111-8111-111111111111';
const EVENT = '22222222-2222-4222-8222-222222222222';

const handle = setupNotificationWorker({
  agent: {
    findMany: async ({ where }: { where: { role: unknown } }) =>
      JSON.stringify(where.role).includes('SUPERVISOR')
        ? [{ id: 'supervisor-a' }, { id: 'admin-b' }]
        : [{ id: 'admin-b', email: 'b@example.com' }],
  },
  tenant: { findUnique: async () => ({ name: '測試站台' }) },
  conversation: {
    findFirst: async () => ({ assignedToId: null, contactId: 'contact-1', contact: { displayName: '客人' } }),
  },
} as never);

beforeEach(() => {
  sent.jobs = [];
  sent.emails = [];
  sent.redisDown = false;
});

function event(name: string, payload: Record<string, unknown>) {
  return { id: EVENT, name: name as never, tenantId: TENANT, timestamp: new Date(), payload };
}

test('同一個事件處理兩次：兩次的 notification:dispatch job id 都是 <事件 id>__<客服人員 id>', async () => {
  const e = event('case.assigned', { caseId: 'case-1', assigneeId: 'agent-x', title: 'T' });
  await handle(e);
  await handle(e);
  const ids = sent.jobs.filter((j) => j.name === 'notification:dispatch').map((j) => j.opts?.jobId);
  assert.deepEqual(ids, [`${EVENT}__agent-x`, `${EVENT}__agent-x`]);
});

test('同一個事件通知多位客服人員：每位客服人員各一個 job id', async () => {
  await handle(event('message.received', { conversationId: 'conv-1' }));
  const ids = sent.jobs.filter((j) => j.name === 'notification:dispatch').map((j) => j.opts?.jobId);
  assert.deepEqual(ids, [`${EVENT}__supervisor-a`, `${EVENT}__admin-b`]);
});

test('告警事件處理兩次：告警信改走 usage-alert-email 佇列，兩次的 job id 都是 <事件 id>__<管理員 id>，訂閱者不直接寄信', async () => {
  const e = event('usage.quota.threshold', { level: 'warning', usedTokens: 800, limitTokens: 1000, monthKey: '2026-10' });
  await handle(e);
  await handle(e);
  const emailJobs = sent.jobs.filter((j) => j.queue === USAGE_ALERT_EMAIL_QUEUE);
  assert.deepEqual(emailJobs.map((j) => j.opts?.jobId), [`${EVENT}__admin-b`, `${EVENT}__admin-b`]);
  assert.deepEqual(sent.emails, []);
});

test('Subscriber cannot enqueue the next job：送不出通知或告警信的 job 時處理失敗，由 BullMQ 重試', async () => {
  sent.redisDown = true;
  await assert.rejects(handle(event('case.assigned', { caseId: 'case-1', assigneeId: 'agent-x', title: 'T' })), /redis down/);
  await assert.rejects(handle(event('message.received', { conversationId: 'conv-1', contactId: 'contact-1' })), /redis down/);
});
